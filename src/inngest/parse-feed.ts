import { getDatabase } from "#/db"
import type { Feed } from "#/db/types"
import { inngest } from "#/inngest"
import { NonRetriableError } from "inngest"
import Parser from "rss-parser"

export const parseFeed = inngest.createFunction(
	{
		id: "parse-feed",
		retries: 3,
	},
	{ event: "feed/parse.requested" },
	async ({ event, step }) => {
		const { feedId } = event.data

		const feed = await step.run("validate-feed", async () => {
			const db = getDatabase()
			// Validate feed exists and is active (outside steps - fast validation)
			const feed = db.prepare<[id: number], Feed>(`
				SELECT * FROM feeds WHERE id = ?
			`).get(feedId)

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
				headers['If-None-Match'] = feed.etag
			}
			if (feed.last_modified_header) {
				headers['If-Modified-Since'] = feed.last_modified_header
			}

			const response = await fetch(feed.url, {
				headers,
				signal: AbortSignal.timeout(30_000),
			})

			// Handle 304 Not Modified
			if (response.status === 304) {
				return { status: 304 as const }
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			const xml = await response.text()
			const etag = response.headers.get('etag')
			const lastModified = response.headers.get('last-modified')

			return { xml, etag, lastModified, status: 200 as const }
		})

		// Handle 304 Not Modified
		if (fetchResult.status === 304) {
			await step.run("update-last-fetched", async () => {
				const db = getDatabase()
				db.prepare(`
					UPDATE feeds
					SET last_fetched_at = CURRENT_TIMESTAMP
					WHERE id = ?
				`).run(feedId)
			})

			return {
				feedId,
				status: 'not-modified',
				message: 'Feed has not changed since last fetch'
			}
		}

		// Parse the RSS feed
		const parsedFeed = await step.run({ id: "parse-rss-xml" }, async () => {
			const parser = new Parser()
			try {
				return parser.parseString(fetchResult.xml)
			} catch (cause) {
				throw new NonRetriableError('Failed to parse RSS feed XML', { cause })
			}
		})

		// Update feed metadata
		await step.run("update-feed-metadata", async () => {
			const db = getDatabase()
			db.prepare<[
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
			]>(`
				UPDATE feeds
				SET 
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
		const newArticles = await step.run("insert-articles", async () => {
			const db = getDatabase()
			const insertArticle = db.prepare<[
				feed_id: number,
				guid: string,
				guid_is_permalink: number,
				url: string | null,
				title: string,
				content: string | null,
				summary: string | null,
				author_name: string | null,
				published_at: string | null,
				categories: string | null
			]>(`
				INSERT OR IGNORE INTO articles (
				feed_id,
				guid,
				guid_is_permalink,
				url,
				title,
				content,
				summary,
				author_name,
				published_at,
				categories
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)

			let newArticles = 0
			db.transaction(() => {
				for (const item of parsedFeed.items ?? []) {
					const result = insertArticle.run(
						feedId,
						item.guid ?? item.link ?? item.title ?? 'unknown',
						item.guid && item.guid === item.link ? 1 : 0,
						item.link ?? null,
						item.title ?? 'Untitled',
						typeof item.content === 'string' ? item.content : (typeof item['content:encoded'] === 'string' ? item['content:encoded'] : null),
						item.contentSnippet ?? item.summary ?? null,
						typeof item.creator === 'string' ? item.creator : (typeof item.author === 'string' ? item.author : null),
						item.pubDate ? new Date(item.pubDate).toISOString() : null,
						item.categories ? JSON.stringify(item.categories) : null
					)
					if (result.changes > 0) {
						newArticles++
					}
				}
			})()

			return newArticles
		})

		return {
			feedId,
			status: 'success',
			feedTitle: parsedFeed.title,
			totalItems: parsedFeed.items?.length ?? 0,
			newArticles,
		}
	}
)