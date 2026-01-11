import { getDatabase } from "#/db"
import type { Article } from "#/db/types"
import { inngest } from "#/inngest/inngest"
import { Readability } from "@mozilla/readability"
import { RetryAfterError } from "inngest"
import { parseHTML } from "linkedom"
import { getSSEManager } from "#/sse/sse-manager"
import DOMPurify from "dompurify"

/**
 * Convert relative URLs in HTML content to absolute URLs using the article's URL as base
 */
function makeUrlsAbsolute(document: Document, baseUrl: string): Document {

	const urlAttributes = [
		{ selector: "img", attr: "src" },
		{ selector: "img", attr: "srcset" },
		{ selector: "img", attr: "srcSet", },
		{ selector: "a", attr: "href" },
		{ selector: "link", attr: "href" },
		{ selector: "source", attr: "src" },
		{ selector: "source", attr: "srcset", },
		{ selector: "source", attr: "srcSet" },
		{ selector: "video", attr: "src" },
		{ selector: "audio", attr: "src" },
		{ selector: "iframe", attr: "src" }
	]

	for (const { selector, attr } of urlAttributes) {
		const elements = document.querySelectorAll(selector)
		for (const element of elements) {
			const value = element.getAttribute(attr)
			if (!value) continue

			if (attr.toLowerCase() === "srcset") {
				// Handle srcset specially (it can have multiple URLs)
				const srcsetParts = value.split(",").map((part) => {
					const trimmed = part.trim()
					const [url, ...rest] = trimmed.split(/\s+/)
					try {
						const absoluteUrl = new URL(url, baseUrl).href
						return [absoluteUrl, ...rest].join(" ")
					} catch {
						return trimmed
					}
				})
				element.removeAttribute('srcset')
				element.removeAttribute('srcSet')
				element.setAttribute(attr.toLowerCase(), srcsetParts.join(", "))
			} else {
				if (value.startsWith("#") || value.startsWith("data:")) {
					// Skip fragment identifiers and data URLs
					continue
				}
				// Handle regular URL attributes
				try {
					const absoluteUrl = new URL(value, baseUrl).href
					element.setAttribute(attr, absoluteUrl)
				} catch {
					// If URL parsing fails, leave it as is
				}
			}
		}
	}

	return document
}

export const parseArticle = inngest.createFunction(
	{
		id: "parse-article",
		retries: 3,
		concurrency: {
			limit: 1,
			key: "event.data.feedId"
		}
	},
	{ event: "article/parse" },
	async ({ event, step }) => {
		const { feedId, articleId } = event.data

		// Fetch article from database
		const article = await step.run("fetch-article", () => {
			const db = getDatabase()
			const article = db
				.prepare<[id: number], Article>(`
				SELECT * FROM articles WHERE id = ?
			`)
				.get(articleId)

			if (!article) {
				throw new Error(`Article with id ${articleId} not found`)
			}

			if (!article.url) {
				throw new Error(`Article with id ${articleId} has no URL to fetch`)
			}

			return article
		})

		// Fetch article HTML content
		const html = await step.run("fetch-article-html", async () => {
			const response = await fetch(article.url!, {
				headers: {
					"User-Agent": "RSS-Reader/1.0",
					Accept: "text/html,application/xhtml+xml"
				},
				signal: AbortSignal.timeout(20_000),
				redirect: "follow"
			})

			if (response.status === 429 && response.headers.get("Retry-After")) {
				const retryAfter = parseInt(response.headers.get("Retry-After")!, 10)
				throw new RetryAfterError(`Rate limited. Retry after ${retryAfter} seconds.`, retryAfter)
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			return await response.text()
		})

		// Parse article content with Readability
		const parsed = await step.run("parse-article-content", () => {
			const window = parseHTML(html)
			const reader = new Readability(window.document)
			const parsed = reader.parse()

			if (!parsed) {
				throw new Error("Failed to extract article content with Readability")
			}

			// Sanitize the extracted content
			if (parsed.content) {
				const purify = DOMPurify(window)
				parsed.content = purify.sanitize(parsed.content)
				// Convert relative URLs to absolute URLs in the extracted content
				{
					// Parse the content as a full HTML document
					const { document } = parseHTML(`<!DOCTYPE html><html><head></head><body>${parsed.content}</body></html>`)
					const absoluteDoc = makeUrlsAbsolute(document, article.url!)
					parsed.content = absoluteDoc.body.innerHTML
				}
			}

			return parsed
		})

		// Update article in database with extracted content
		await step.run("update-article-content", () => {
			const db = getDatabase()
			db.prepare<
				[
					content: string,
					summary: string | null,
					author_name: string | null,
					source_title: string | null,
					published_at: string | null,
					fetch_status: "complete",
					id: number
				]
			>(`
				UPDATE articles
				SET 
					content = ?,
					summary = COALESCE(?, summary),
					author_name = COALESCE(?, author_name),
					source_title = COALESCE(?, source_title),
					published_at = COALESCE(?, published_at),
					fetch_status = ?
				WHERE id = ?
			`).run(
				parsed.content ?? "",
				parsed.excerpt ?? null,
				parsed.byline ?? null,
				parsed.siteName ?? null,
				parsed.publishedTime ?? null,
				"complete",
				articleId
			)
		})

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
					sseManager.notifyUser(subscriber.user_id, "article.parsed", {
						articleId,
						feedId,
						title: parsed.title ?? undefined,
						contentLength: parsed.length ?? 0
					})
				)
			)

			return { notifiedUsers: subscribers.length }
		})

		return {
			articleId,
			feedId,
			status: "success",
			title: parsed.title,
			contentLength: parsed.length
		}
	}
)
