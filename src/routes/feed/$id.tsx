import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getDatabase } from "#/db"
import type { Article, Feed } from "#/db/types"
import { getUserId } from "#/sso/getUserId"
import { inngest } from "#/inngest/inngest"
import * as v from "valibot"
import styles from "./-$id.module.css"
import { useEffect, useRef, useCallback, useState, useMemo } from "react"

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

		// Get articles with user interaction data
		const articles = db
			.prepare<
				[userId: string, feedId: number],
				Article & {
					is_read: number
					is_bookmarked: number
					is_favorited: number
				}
			>(
				`
				SELECT 
					a.*,
					COALESCE(ua.is_read, 0) as is_read,
					COALESCE(ua.is_bookmarked, 0) as is_bookmarked,
					COALESCE(ua.is_favorited, 0) as is_favorited
				FROM articles a
				LEFT JOIN user_article ua ON a.id = ua.article_id AND ua.user_id = ?
				WHERE a.feed_id = ?
				ORDER BY a.published_at DESC
			`
			)
			.all(userId, feedId)

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
	const [readFilter, setReadFilter] = useState<"all" | "read" | "unread">("unread")
	const [favoriteFilter, setFavoriteFilter] = useState<"all" | "favorites">("all")
	const [bookmarkFilter, setBookmarkFilter] = useState<"all" | "bookmarked">("all")

	const filteredArticles = useMemo(() => {
		return articles.filter((article) => {
			if (readFilter === "read" && !article.is_read) return false
			if (readFilter === "unread" && article.is_read) return false
			if (favoriteFilter === "favorites" && !article.is_favorited) return false
			if (bookmarkFilter === "bookmarked" && !article.is_bookmarked) return false
			return true
		})
	}, [articles, readFilter, favoriteFilter, bookmarkFilter])

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

		// Only observe articles that haven't been parsed yet
		const unparsedArticles = filteredArticles.filter(
			(article) => article.fetch_status === "none" || article.fetch_status === "failed"
		)

		unparsedArticles.forEach((article) => {
			const el = document.querySelector(`[data-article-id="${article.id}"]`)
			if (el) observer.observe(el)
		})

		return () => observer.disconnect()
	}, [filteredArticles, triggerArticleParsing])

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

			<div className={styles.filters}>
				<div className={styles.filterGroup}>
					<label>Read Status:</label>
					<select value={readFilter} onChange={(e) => setReadFilter(e.target.value as any)}>
						<option value="all">All</option>
						<option value="read">Read</option>
						<option value="unread">Unread</option>
					</select>
				</div>
				<div className={styles.filterGroup}>
					<label>Favorites:</label>
					<select value={favoriteFilter} onChange={(e) => setFavoriteFilter(e.target.value as any)}>
						<option value="all">All</option>
						<option value="favorites">Favorites</option>
					</select>
				</div>
				<div className={styles.filterGroup}>
					<label>Bookmarks:</label>
					<select value={bookmarkFilter} onChange={(e) => setBookmarkFilter(e.target.value as any)}>
						<option value="all">All</option>
						<option value="bookmarked">Bookmarked</option>
					</select>
				</div>
			</div>

			{articles.length === 0 ? (
				<div className={styles.emptyState}>
					<p>No articles found in this feed yet.</p>
					<p>Articles will appear here once the feed has been fetched and parsed.</p>
				</div>
			) : (
				<div>
					<h2 className={styles.articlesHeader}>
						Articles ({filteredArticles.length}
						{filteredArticles.length !== articles.length && ` of ${articles.length}`})
					</h2>
					<ul className={styles.articleList}>
						{filteredArticles.map((article) => (
							<li key={article.id} data-article-id={article.id}>
								<Link
									to="/article/$id"
									params={{ id: article.id }}
									className={styles.articleItem}
								>
									<div className={styles.articleContent}>
										<div className={styles.articleInfo}>
											<div className={styles.articleTitleRow}>
												<h3 className={styles.articleTitle}>{article.title}</h3>
												<div className={styles.statusBadges}>
													{!article.is_read && <span className={styles.badge} title="Unread">●</span>}
													{article.is_favorited ? (
														<span className={styles.badge} title="Favorite">★</span>
													) : null}
													{article.is_bookmarked ? (
														<span className={styles.badge} title="Bookmarked">🔖</span>
													) : null}
													{article.fetch_status !== "complete" && article.fetch_status !== "scheduled" ? (
														<span className={styles.badge} title="Not parsed yet">⏳</span>
													) : null}
												</div>
											</div>
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
