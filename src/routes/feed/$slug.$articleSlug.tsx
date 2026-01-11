import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getDatabase } from "#/db"
import type { Article, UserArticle } from "#/db/types"
import { getUserId } from "#/sso/getUserId"
import * as v from "valibot"
import styles from "./-$slug.$articleSlug.module.css"
import { useEffect, useRef, useState } from "react"

const getArticle = createServerFn({
	method: "GET"
})
	.inputValidator(v.object({ feedSlug: v.string(), articleSlug: v.string() }))
	.handler(async ({ data: { feedSlug, articleSlug }, signal }) => {
		const userId = await getUserId({ signal })
		const db = getDatabase()

		// Get article details
		const article = db
			.prepare<[feedSlug: string, articleSlug: string], Article & { feed_slug: string }>(` 
				SELECT a.*, f.slug as feed_slug FROM articles a
				INNER JOIN feeds f ON a.feed_id = f.id
				WHERE f.slug = ? AND a.slug = ?
			`)
			.get(feedSlug, articleSlug)

		if (!article) {
			throw notFound()
		}

		// Verify user has access to this article via subscription
		const subscription = db
			.prepare<[userId: string, feedId: number], { feed_id: number }>(`
				SELECT feed_id FROM subscriptions 
				WHERE user_id = ? AND feed_id = ?
			`)
			.get(userId, article.feed_id)

		if (!subscription) {
			throw notFound()
		}

		// Get user interaction status
		const userArticle = db
			.prepare<[userId: string, articleId: number], UserArticle>(`
				SELECT * FROM user_article
				WHERE user_id = ? AND article_id = ?
			`)
			.get(userId, article.id)

		return { article, userArticle }
	})

const markAsRead = createServerFn({
	method: "POST"
})
	.inputValidator(v.number())
	.handler(async ({ data: articleId, signal }) => {
		const userId = await getUserId({ signal })
		const db = getDatabase()

		// Upsert to user_article table
		db.prepare<[userId: string, articleId: number]>(`
			INSERT INTO user_article (user_id, article_id, is_read, read_at)
			VALUES (?, ?, 1, CURRENT_TIMESTAMP)
			ON CONFLICT(user_id, article_id) 
			DO UPDATE SET 
				is_read = 1, 
				read_at = CURRENT_TIMESTAMP
		`).run(userId, articleId)

		return { success: true }
	})

const toggleFavorite = createServerFn({
	method: "POST"
})
	.inputValidator(v.object({ articleId: v.number(), isFavorited: v.boolean() }))
	.handler(async ({ data: { articleId, isFavorited }, signal }) => {
		const userId = await getUserId({ signal })
		const db = getDatabase()

		// Upsert to user_article table
		db.prepare<[userId: string, articleId: number, isFavorited: number, isFavorited2: number]>(`
			INSERT INTO user_article (user_id, article_id, is_favorited)
			VALUES (?, ?, ?)
			ON CONFLICT(user_id, article_id) 
			DO UPDATE SET is_favorited = ?
		`).run(userId, articleId, isFavorited ? 1 : 0, isFavorited ? 1 : 0)

		return { success: true, isFavorited }
	})

const toggleBookmark = createServerFn({
	method: "POST"
})
	.inputValidator(v.object({ articleId: v.number(), isBookmarked: v.boolean() }))
	.handler(async ({ data: { articleId, isBookmarked }, signal }) => {
		const userId = await getUserId({ signal })
		const db = getDatabase()

		// Upsert to user_article table
		db.prepare<[userId: string, articleId: number, isBookmarked: number, isBookmarked2: number]>(`
			INSERT INTO user_article (user_id, article_id, is_bookmarked)
			VALUES (?, ?, ?)
			ON CONFLICT(user_id, article_id) 
			DO UPDATE SET is_bookmarked = ?
		`).run(userId, articleId, isBookmarked ? 1 : 0, isBookmarked ? 1 : 0)

		return { success: true, isBookmarked }
	})

export const Route = createFileRoute("/feed/$slug/$articleSlug")({
	component: ArticlePage,
	loader: ({ abortController, params }) =>
		getArticle({
			data: { feedSlug: params.slug, articleSlug: params.articleSlug },
			signal: abortController.signal
		})
})

function ArticlePage() {
	const { article, userArticle } = Route.useLoaderData()
	const hasMarkedAsRead = useRef(false)
	const [isFavorited, setIsFavorited] = useState(userArticle?.is_favorited ?? false)
	const [isBookmarked, setIsBookmarked] = useState(userArticle?.is_bookmarked ?? false)
	const [isRead, setIsRead] = useState(userArticle?.is_read ?? false)

	const handleToggleFavorite = async () => {
		const newValue = !isFavorited
		setIsFavorited(newValue)
		try {
			await toggleFavorite({ data: { articleId: article.id, isFavorited: newValue } })
		} catch (err) {
			console.error("Failed to toggle favorite:", err)
			setIsFavorited(!newValue)
		}
	}

	const handleToggleBookmark = async () => {
		const newValue = !isBookmarked
		setIsBookmarked(newValue)
		try {
			await toggleBookmark({ data: { articleId: article.id, isBookmarked: newValue } })
		} catch (err) {
			console.error("Failed to toggle bookmark:", err)
			setIsBookmarked(!newValue)
		}
	}

	// Track scroll to mark as read
	useEffect(() => {
		if (hasMarkedAsRead.current || userArticle?.is_read) {
			return
		}

		const handleScroll = () => {
			if (window.scrollY > 150 && !hasMarkedAsRead.current) {
				hasMarkedAsRead.current = true
				markAsRead({ data: article.id }).then(() => {
					setIsRead(true)
					window.removeEventListener("scroll", handleScroll)
				}).catch((err) => {
					console.error("Failed to mark article as read:", err)
					hasMarkedAsRead.current = false
				})
			}
		}

		window.addEventListener("scroll", handleScroll, { passive: true })
		return () => window.removeEventListener("scroll", handleScroll)
	}, [article.id, userArticle?.is_read])

	const hasContent = article.content// && article.fetch_status === "complete"

	console.log("Article content:", article)

	return (
		<div className={styles.container}>
			<nav className={styles.nav}>
				<div className={styles.navLeft}>
					<Link to="/feed/$slug" params={{ slug: article.feed_slug }} className={styles.backLink}>
						← Back to Feed
					</Link>
					<span className={isRead ? styles.readStatus : styles.unreadStatus}>
						{isRead ? "Read" : "Unread"}
					</span>
				</div>
				<div className={styles.navActions}>
					<button
						onClick={handleToggleFavorite}
						className={`${styles.actionButton} ${isFavorited ? styles.active : ""}`}
						title={isFavorited ? "Remove from favorites" : "Add to favorites"}
					>
						{isFavorited ? "★" : "☆"} Favorite
					</button>
					<button
						onClick={handleToggleBookmark}
						className={`${styles.actionButton} ${isBookmarked ? styles.active : ""}`}
						title={isBookmarked ? "Remove bookmark" : "Add bookmark"}
					>
						🔖 {isBookmarked ? "Bookmarked" : "Bookmark"}
					</button>
					{article.url && (
						<a
							href={article.url}
							target="_blank"
							rel="noopener noreferrer"
							className={styles.originalLink}
						>
							View Original →
						</a>
					)}
				</div>
			</nav>

			<article className={styles.article}>
				<header className={styles.header}>
					<h1 className={styles.title}>{article.title}</h1>
					<div className={styles.meta}>
						{article.author_name && (
							<span className={styles.author}>By {article.author_name}</span>
						)}
						{article.published_at && (
							<time className={styles.date}>
								{new Date(article.published_at).toLocaleDateString(undefined, {
									year: "numeric",
									month: "long",
									day: "numeric"
								})}
							</time>
						)}
						{article.source_title && (
							<span className={styles.source}>{article.source_title}</span>
						)}
					</div>
				</header>

				{hasContent ? (
					<div
						className={styles.content}
						dangerouslySetInnerHTML={{ __html: article.content! }}
					/>
				) : (
					<div className={styles.fallback}>
						<div className={styles.fallbackContent}>
							<h2>Content Not Available</h2>
							<p>
								{article.fetch_status === "failed"
									? "We encountered an error while fetching this article's content."
									: article.fetch_status === "scheduled"
										? "This article's content is being fetched. Please check back in a moment."
										: "The full content for this article is not yet available."}
							</p>
							{article.summary && (
								<div className={styles.summary}>
									<h3>Summary</h3>
									<p>{article.summary}</p>
								</div>
							)}
						</div>
					</div>
				)}
			</article>
		</div>
	)
}
