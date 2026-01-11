import { createFileRoute, Link } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getDatabase } from "#/db"
import type { FeedWithSubscription } from "#/db/types"
import styles from "./-index.module.css"
import { getUserId } from "#/sso/getUserId"
import { inngest } from "#/inngest/inngest"
import * as v from "valibot"

/**
 * TODO
 * - adding a feed should itself be an inngest function: check if feed url is valid, if it yields an RSS feed, if not search for RSS feed links in the HTML, etc.
 */

const getUserFeeds = createServerFn({
	method: "GET"
}).handler(async ({ signal }) => {
	const userId = await getUserId({ signal })
	const db = getDatabase()
	return db
		.prepare<[userId: string, userId2: string], FeedWithSubscription>(`
			SELECT 
				f.id,
				f.url,
				f.slug,
				f.title,
				f.description,
				f.image_url,
				f.icon_url,
				f.link,
				f.last_fetched_at,
				f.last_success_at,
				s.category,
				s.created_at as subscribed_at,
				COUNT(CASE WHEN a.id IS NOT NULL AND COALESCE(ua.is_read, 0) = 0 THEN 1 END) as unread_count
			FROM feeds f
			INNER JOIN subscriptions s ON f.id = s.feed_id
			LEFT JOIN articles a ON f.id = a.feed_id
			LEFT JOIN user_article ua ON a.id = ua.article_id AND ua.user_id = ?
			WHERE s.user_id = ?
			GROUP BY f.id
			ORDER BY f.title ASC
		`)
		.all(userId, userId)
})

const addFeedSubscription = createServerFn({
	method: "POST"
})
	.inputValidator(
		v.object({
			feedUrl: v.pipe(v.string(), v.url())
		})
	)
	.handler(async ({ data, signal }) => {
		const userId = await getUserId({ signal })
		const db = getDatabase()

		// Create user in DB if it doesn't exist
		db.prepare(`
			INSERT OR IGNORE INTO users (id) VALUES (?)
		`).run(userId)

		// Create pending feed record
		const result = db
			.prepare(`
				INSERT INTO pending_feeds (user_id, original_url, status)
				VALUES (?, ?, 'pending')
			`)
			.run(userId, data.feedUrl)

		const pendingId = result.lastInsertRowid

		// Trigger Inngest function to validate and add feed
		await inngest.send({
			name: "feed/add.requested",
			data: {
				feedUrl: data.feedUrl,
				requestedBy: userId,
				pendingId
			}
		})

		return { pending: true, pendingId }
	})


export const Route = createFileRoute("/")({
	component: HomePage,
	loader: ({ abortController }) => getUserFeeds({ signal: abortController.signal })
})

function HomePage() {
	const feeds = Route.useLoaderData()

	const handleAddFeed = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		const form = e.currentTarget
		const formData = new FormData(form)
		const feedUrl = formData.get("feedUrl") as string | null

		if (!feedUrl) {
			alert("Please enter a valid feed URL.")
			return
		}

		await addFeedSubscription({ data: { feedUrl } })
		form.reset()
		const dialog = form.closest<HTMLDialogElement>("dialog")
		dialog?.close()
	}

	if (feeds.length === 0) {
		return (
			<div className={styles.container}>
				<div className={styles.emptyState}>
					<h1>Welcome to RSS Reader</h1>
					<p>You don't have any feeds yet. Start by subscribing to your first feed!</p>
					<button
						type="button"
						className={styles.addFeedButton}
						commandfor="add-feed-dialog"
						command="show-modal"
					>
						Add Feed
					</button>
				</div>

				<dialog id="add-feed-dialog" className={styles.dialog}>
					<form method="dialog" className={styles.dialogHeader}>
						<h2>Add New Feed</h2>
						<button type="submit" className={styles.closeButton} aria-label="Close">
							×
						</button>
					</form>
					<form onSubmit={handleAddFeed} className={styles.dialogContent}>
						<label htmlFor="feedUrl" className={styles.label}>
							Feed URL
						</label>
						<input
							type="url"
							id="feedUrl"
							name="feedUrl"
							className={styles.input}
							placeholder="https://example.com/feed.xml"
							required
						/>
						<div className={styles.dialogActions}>
							<button type="button" formMethod="dialog" className={styles.cancelButton}>
								Cancel
							</button>
							<button type="submit" className={styles.submitButton}>
								Add Feed
							</button>
						</div>
					</form>
				</dialog>
			</div>
		)
	}

	return (
		<div className={styles.container}>
			<div className={styles.header}>
				<h1 className={styles.title}>My Feeds</h1>
				<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
					<button
						type="button"
						className={styles.addFeedButton}
						commandfor="add-feed-dialog"
						command="show-modal"
					>
						Add Feed
					</button>
				</div>
			</div>

			<ul className={styles.feedList}>
				{feeds.map((feed) => (
					<li key={feed.id} className={styles.feedItem}>
						<Link
							to="/feed/$slug"
							params={{ slug: feed.slug }}
							style={{ display: "flex", gap: "1rem", textDecoration: "none", color: "inherit" }}
						>
							{feed.image_url && <img src={feed.image_url} alt="" className={styles.feedImage} />}
							<div className={styles.feedContent}>
								<div className={styles.feedTitleRow}>
									<h2 className={styles.feedTitle}>{feed.title || "Untitled Feed"}</h2>
									{feed.unread_count > 0 && (
										<span className={styles.unreadBadge}>{feed.unread_count}</span>
									)}
								</div>
								{feed.description && <p className={styles.feedDescription}>{feed.description}</p>}
								<div className={styles.feedMeta}>
									{feed.category && <span className={styles.category}>{feed.category}</span>}
									{feed.last_success_at && (
										<span className={styles.lastUpdated}>
											Last updated: {new Date(feed.last_success_at).toLocaleDateString()}
										</span>
									)}
								</div>
							</div>
						</Link>
					</li>
				))}
			</ul>

			<dialog id="add-feed-dialog" className={styles.dialog}>
				<form method="dialog" className={styles.dialogHeader}>
					<h2>Add New Feed</h2>
					<button
						type="submit"
						className={styles.closeButton}
						aria-label="Close"
					>
						×
					</button>
				</form>

				<form onSubmit={handleAddFeed} className={styles.dialogContent}>
					<label htmlFor="feedUrl" className={styles.label}>
						Feed URL
					</label>
					<input
						type="url"
						id="feedUrl"
						name="feedUrl"
						className={styles.input}
						placeholder="https://example.com/feed.xml"
						required
					/>
					<div className={styles.dialogActions}>
						<button
							type="button"
							formMethod="dialog"
							className={styles.cancelButton}
						>
							Cancel
						</button>
						<button type="submit" className={styles.submitButton}>
							Add Feed
						</button>
					</div>
				</form>
			</dialog>
		</div>
	)
}

declare module "react" {
	interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
		commandfor?: string
		command?: "show-modal" | "close" | "toggle-popover" | "hide-popover"
	}
}
