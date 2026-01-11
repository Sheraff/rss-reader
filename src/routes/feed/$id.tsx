import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getDatabase } from "#/db"
import type { Article, Feed } from "#/db/types"
import { getUserId } from "#/sso/getUserId"
import { inngest } from "#/inngest/inngest"
import * as v from "valibot"
import styles from "./-$id.module.css"
import { useEffect, useRef, useCallback } from "react"

const getFeedArticles = createServerFn({
	method: "GET"
})
	.inputValidator(v.number())
	.handler(async ({ data: feedId, signal }) => {
		const userId = await getUserId({ signal })
		const db = getDatabase()

		// First, verify the user is subscribed to this feed
		const subscription = db
			.prepare<[userId: string, feedId: number], { feed_id: number }>(`
				SELECT feed_id FROM subscriptions 
				WHERE user_id = ? AND feed_id = ?
			`)
			.get(userId, feedId)

		if (!subscription) {
			throw notFound()
		}

		// Get feed details
		const feed = db
			.prepare<[feedId: number], Feed>(`
				SELECT * FROM feeds WHERE id = ?
			`)
			.get(feedId)

		if (!feed) {
			throw notFound()
		}

		// Get articles
		const articles = db
			.prepare<[feedId: number], Article>(`
				SELECT * FROM articles
				WHERE feed_id = ?
				ORDER BY published_at DESC
			`)
			.all(feedId)

		return { feed, articles }
	})

const parseArticle = createServerFn({
	method: "POST"
})
	.inputValidator(v.number())
	.handler(async ({ data: articleId, signal }) => {
		const userId = await getUserId({ signal })
		const db = getDatabase()

		// Get the article and verify user has access to it
		const article = db
			.prepare<[articleId: number], Article & { feed_id: number }>(
				`
				SELECT a.*, a.feed_id
				FROM articles a
				WHERE a.id = ?
			`
			)
			.get(articleId)

		if (!article) {
			throw new Error("Article not found")
		}

		// Verify user is subscribed to the article's feed
		const subscription = db
			.prepare<[userId: string, feedId: number], { feed_id: number }>(
				`
				SELECT feed_id FROM subscriptions 
				WHERE user_id = ? AND feed_id = ?
			`
			)
			.get(userId, article.feed_id)

		if (!subscription) {
			throw new Error("Access denied")
		}

		// Only trigger parsing if not already parsed (check fetch_status)
		if (article.fetch_status === "none" || article.fetch_status === "failed") {
			await inngest.send({
				name: "article/parse",
				data: {
					feedId: article.feed_id,
					articleId
				}
			})

			return { success: true, message: "Article parsing triggered" }
		}

		return { success: true, message: "Article already parsed" }
	})

export const Route = createFileRoute("/feed/$id")({
	component: FeedPage,
	params: {
		parse: (p) =>
			v.parse(
				v.object({
					id: v.union([
						v.number(),
						v.pipe(
							v.string(),
							v.transform((val) => parseInt(val, 10)),
							v.number()
						)
					])
				}),
				p
			)
	},
	loader: ({ abortController, params }) =>
		getFeedArticles({ data: params.id, signal: abortController.signal })
})

function FeedPage() {
	const { feed, articles } = Route.useLoaderData()
	const parsedArticles = useRef<Set<number> | null>(null)

	// Trigger article parsing when it comes into view
	const triggerArticleParsing = useCallback(async (articleId: number) => {
		if (!parsedArticles.current) {
			parsedArticles.current = new Set<number>()
		}
		if (parsedArticles.current.has(articleId)) {
			return
		}

		parsedArticles.current.add(articleId)

		try {
			await parseArticle({ data: articleId })
		} catch (error) {
			console.error("Failed to trigger article parsing:", error)
			// Remove from set so it can be retried
			parsedArticles.current.delete(articleId)
		}
	}, [])

	// Set up intersection observer for lazy parsing
	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						const articleId = parseInt(entry.target.getAttribute("data-article-id")!, 10)
						triggerArticleParsing(articleId)
					}
				})
			},
			{
				rootMargin: "200px" // Start parsing 200px before article is visible
			}
		)

		// Observe all article items
		const articleElements = document.querySelectorAll("[data-article-id]")
		articleElements.forEach((el) => observer.observe(el))

		return () => observer.disconnect()
	}, [articles, triggerArticleParsing])

	return (
		<div className={styles.container}>
			<nav>
				<Link to="/" className={styles.backLink}>
					← Back to Feeds
				</Link>
			</nav>

			<header className={styles.header}>
				<div className={styles.headerContent}>
					{feed.image_url && <img src={feed.image_url} alt="" className={styles.feedImage} />}
					<div className={styles.feedInfo}>
						<h1>{feed.title || "Untitled Feed"}</h1>
						{feed.description && <p className={styles.feedDescription}>{feed.description}</p>}
						{feed.link && (
							<a
								href={feed.link}
								target="_blank"
								rel="noopener noreferrer"
								className={styles.feedLink}
							>
								Visit Website →
							</a>
						)}
					</div>
				</div>
			</header>

			{articles.length === 0 ? (
				<div className={styles.emptyState}>
					<p>No articles found in this feed yet.</p>
					<p>Articles will appear here once the feed has been fetched and parsed.</p>
				</div>
			) : (
				<div>
					<h2 className={styles.articlesHeader}>Articles ({articles.length})</h2>
					<ul className={styles.articleList}>
						{articles.map((article) => (
							<li key={article.id} data-article-id={article.id}>
								<Link
									to="/article/$id"
									params={{ id: article.id }}
									className={styles.articleItem}
								>
									<div className={styles.articleContent}>
										<div className={styles.articleInfo}>
											<h3 className={styles.articleTitle}>{article.title}</h3>
											{article.summary && (
												<p className={styles.articleSummary}>
													{article.summary.substring(0, 200)}
													{article.summary.length > 200 ? "..." : ""}
												</p>
											)}
											<div className={styles.articleMeta}>
												{article.author_name && <span>By {article.author_name}</span>}
												{article.published_at && (
													<span>{new Date(article.published_at).toLocaleDateString()}</span>
												)}
											</div>
										</div>
										<div className={styles.articleArrow}>→</div>
									</div>
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	)
}
