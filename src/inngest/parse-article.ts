import { getDatabase } from "#/db"
import type { Article } from "#/db/types"
import { inngest } from "#/inngest/inngest"
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"

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

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			return await response.text()
		})

		// Parse article content with Readability
		const parsed = await step.run("parse-article-content", () => {
			const { document } = parseHTML(html)
			const reader = new Readability(document)
			const article = reader.parse()

			if (!article) {
				throw new Error("Failed to extract article content with Readability")
			}

			return article
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

		return {
			articleId,
			feedId,
			status: "success",
			title: parsed.title,
			contentLength: parsed.length
		}
	}
)
