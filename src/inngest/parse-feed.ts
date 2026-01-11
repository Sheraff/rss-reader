import { getDatabase } from "#/db"
import { generateUniqueSlug, generateUniqueArticleSlug } from "#/db/slug"
import type { Feed } from "#/db/types"
import { inngest } from "#/inngest/inngest"
import { NonRetriableError, RetryAfterError } from "inngest"
import Parser from "rss-parser"
import { getSSEManager } from "#/sse/sse-manager"

/**
 * TODO: 
 * - create a slug field for feeds to use in URLs (should be unique)
 */
export const parseFeed = inngest.createFunction(
	{
		id: "parse-feed",
		retries: 3,
		concurrency: 2
	},
	{ event: "feed/parse.requested" },
	async ({ event, step }) => {
		const { feedId } = event.data

		const feed = await step.run("validate-feed", () => {
			const db = getDatabase()
			// Validate feed exists and is active (outside steps - fast validation)
			const feed = db
				.prepare<[id: number], Feed>(`
				SELECT * FROM feeds WHERE id = ?
			`)
				.get(feedId)

			if (!feed) {
				throw new Error(`Feed with id ${feedId} not found`)
			}

			if (!feed.is_active) {
				throw new Error(`Feed with id ${feedId} is not active`)
			}

			return feed
		})

		// Fetch the RSS feed with conditional requests and timeout
		const fetchResult = await step.run("fetch-rss-feed", async () => {
			const headers: HeadersInit = {}
			if (feed.etag) {
				headers["If-None-Match"] = feed.etag
			}
			if (feed.last_modified_header) {
				headers["If-Modified-Since"] = feed.last_modified_header
			}

			const response = await fetch(feed.url, {
				headers,
				signal: AbortSignal.timeout(30_000)
			})

			// Handle 304 Not Modified
			if (response.status === 304) {
				return { status: 304 as const }
			}

			if (response.status === 429 && response.headers.get("Retry-After")) {
				const retryAfter = parseInt(response.headers.get("Retry-After")!, 10)
				throw new RetryAfterError(`Rate limited. Retry after ${retryAfter} seconds.`, retryAfter)
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			const xml = await response.text()
			const etag = response.headers.get("etag")
			const lastModified = response.headers.get("last-modified")

			return { xml, etag, lastModified, status: 200 as const }
		})

		// Handle 304 Not Modified
		if (fetchResult.status === 304) {
			await step.run("update-last-fetched", () => {
				const db = getDatabase()
				db.prepare(`
					UPDATE feeds
					SET last_fetched_at = CURRENT_TIMESTAMP
					WHERE id = ?
				`).run(feedId)
			})

			return {
				feedId,
				status: "not-modified",
				message: "Feed has not changed since last fetch"
			}
		}

		// Parse the RSS feed
		const parsedFeed = await step.run({ id: "parse-rss-xml" }, () => {
			const parser = new Parser()
			try {
				return parser.parseString(fetchResult.xml)
			} catch (cause) {
				throw new NonRetriableError("Failed to parse RSS feed XML", { cause })
			}
		})

		// Update feed metadata
		await step.run("update-feed-metadata", () => {
			const db = getDatabase()

			// Generate new slug if title is being set for the first time or has changed
			const newSlug = generateUniqueSlug(db, parsedFeed.title, feed.url)

			db.prepare<
				[
					slug: string,
					title: string | null,
					description: string | null,
					link: string | null,
					language: string | null,
					author_name: string | null,
					image_url: string | null,
					image_title: string | null,
					last_build_date: string | null,
					etag: string | null,
					last_modified_header: string | null,
					id: number
				]
			>(`
				UPDATE feeds
				SET 
					slug = ?,
					title = ?,
					description = ?,
					link = ?,
					language = ?,
					author_name = ?,
					image_url = ?,
					image_title = ?,
					last_build_date = ?,
					etag = ?,
					last_modified_header = ?,
					last_fetched_at = CURRENT_TIMESTAMP,
					last_success_at = CURRENT_TIMESTAMP,
					fetch_error_count = 0,
					fetch_error_message = NULL
				WHERE id = ?
			`).run(
				newSlug,
				parsedFeed.title ?? null,
				parsedFeed.description ?? null,
				parsedFeed.link ?? null,
				parsedFeed.language ?? null,
				parsedFeed.itunes?.author ?? null,
				parsedFeed.image?.url ?? parsedFeed.itunes?.image ?? null,
				parsedFeed.image?.title ?? null,
				parsedFeed.lastBuildDate ? new Date(parsedFeed.lastBuildDate).toISOString() : null,
				fetchResult.etag,
				fetchResult.lastModified,
				feedId
			)
		})

		// Insert articles (using INSERT OR IGNORE for deduplication)
		const newArticleIds = await step.run("insert-articles", () => {
			const db = getDatabase()
			const insertArticle = db.prepare<
				[
					feed_id: number,
					guid: string,
					guid_is_permalink: number,
					url: string | null,
					slug: string,
					title: string,
					content: string | null,
					summary: string | null,
					author_name: string | null,
					published_at: string | null,
					categories: string | null
				]
			>(`
				INSERT OR IGNORE INTO articles (
				feed_id,
				guid,
				guid_is_permalink,
				url,
				slug,
				title,
				content,
				summary,
				author_name,
				published_at,
				categories
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)

			const newArticleIds: Array<number | bigint> = []
			db.transaction(() => {
				for (const item of parsedFeed.items ?? []) {
					// Generate unique slug for article
					const articleSlug = generateUniqueArticleSlug(
						db,
						feedId,
						item.title ?? "Untitled",
						item.link ?? null
					)

					const result = insertArticle.run(
						feedId,
						item.guid ?? item.link ?? item.title ?? "unknown",
						item.guid && item.guid === item.link ? 1 : 0,
						item.link ?? null,
						articleSlug,
						item.title ?? "Untitled",
						typeof item.content === "string"
							? item.content
							: typeof item["content:encoded"] === "string"
								? item["content:encoded"]
								: null,
						item.contentSnippet ?? item.summary ?? null,
						typeof item.creator === "string"
							? item.creator
							: typeof item.author === "string"
								? item.author
								: null,
						item.pubDate ? new Date(item.pubDate).toISOString() : null,
						item.categories ? JSON.stringify(item.categories) : null
					)
					if (result.changes > 0) {
						newArticleIds.push(result.lastInsertRowid)
					}
				}
			})()

			return newArticleIds
		})

		// Fan out to parse individual articles (only the 20 most recent)
		if (newArticleIds.length > 0) {
			// Query DB to get the 20 most recent articles by published_at
			// Cannot rely on insertion order as RSS feeds may not be chronologically sorted
			const articlesToParseImmediately = await step.run("get-recent-articles", () => {
				const db = getDatabase()
				return db
					.prepare<[feedId: number], { id: number }>(`
						SELECT id 
						FROM articles 
						WHERE feed_id = ? 
						ORDER BY published_at DESC 
						LIMIT 20
					`)
					.all(feedId)
					.map((row) => row.id)
			})

			await step.sendEvent(
				"fan-out-parse-articles",
				articlesToParseImmediately.map((articleId) => ({
					name: "article/parse",
					data: {
						feedId,
						articleId
					}
				}))
			)

			// Notify subscribers via SSE
			await step.run("notify-subscribers", async () => {
				const db = getDatabase()
				// Get all users subscribed to this feed
				const subscribers = db
					.prepare<[feedId: number], { user_id: string }>(
						`SELECT DISTINCT user_id FROM subscriptions WHERE feed_id = ?`
					)
					.all(feedId)

				// Send notification to each subscriber
				const sseManager = getSSEManager()
				await Promise.allSettled(
					subscribers.map((subscriber) =>
						sseManager.notifyUser(subscriber.user_id, "feed.parsed", {
							feedId,
							feedTitle: parsedFeed.title,
							newArticles: newArticleIds.length,
							totalItems: parsedFeed.items?.length ?? 0
						})
					)
				)

				return { notifiedUsers: subscribers.length }
			})
		}

		return {
			feedId,
			status: "success",
			feedTitle: parsedFeed.title,
			totalItems: parsedFeed.items?.length ?? 0,
			newArticles: newArticleIds.length
		}
	}
)
