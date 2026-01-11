import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getDatabase } from "#/db"
import type { Article, UserArticle } from "#/db/types"
import { getUserId } from "#/sso/getUserId"
import * as v from "valibot"
import styles from "./-$id.module.css"
import { useEffect, useRef } from "react"

const getArticle = createServerFn({
	method: "GET"
})
	.inputValidator(v.number())
	.handler(async ({ data: articleId, signal }) => {
		const userId = await getUserId({ signal })
		const db = getDatabase()

		// Get article details
		const article = db
			.prepare<[articleId: number], Article>(`
				SELECT * FROM articles WHERE id = ?
			`)
			.get(articleId)

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
			.get(userId, articleId)

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

export const Route = createFileRoute("/article/$id")({
	component: ArticlePage,
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
		getArticle({ data: params.id, signal: abortController.signal })
})

function ArticlePage() {
	const { article, userArticle } = Route.useLoaderData()
	const hasMarkedAsRead = useRef(false)

	// Track scroll to mark as read
	useEffect(() => {
		if (hasMarkedAsRead.current || userArticle?.is_read) {
			return
		}

		const handleScroll = () => {
			if (window.scrollY > 150 && !hasMarkedAsRead.current) {
				hasMarkedAsRead.current = true
				markAsRead({ data: article.id }).then(() => {
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
				<Link to="/feed/$id" params={{ id: article.feed_id }} className={styles.backLink}>
					← Back to Feed
				</Link>
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
