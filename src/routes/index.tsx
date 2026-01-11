import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
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
		.prepare<[userId: string], FeedWithSubscription>(`
			SELECT 
				f.id,
				f.url,
				f.title,
				f.description,
				f.image_url,
				f.icon_url,
				f.link,
				f.last_fetched_at,
				f.last_success_at,
				s.category,
				s.created_at as subscribed_at
			FROM feeds f
			INNER JOIN subscriptions s ON f.id = s.feed_id
			WHERE s.user_id = ?
			ORDER BY f.title ASC
		`)
		.all(userId)
})

/**
 * We need to change this server function: adding a feed should itself be an inngest function because there is a lot to do.
 * 1. check if URL is already registered as a feed
 *   1.1 if so, just return the feed id
 * 2. check if URL actually responds anything
 * 3. check if what it responds is a valid RSS feed
 *   3.1 if so, then create feed row
 *   3.2 then send event for feed parse
 *   3.3 return the feed id
 * 4. if it's not a valid RSS feed, search the HTML for an RSS feed URL. For each found, filter out those that do not respond with a valid RSS feed
 *   4.1 if found a single one, loop back to step 1 with that
 *   4.2 if found multiple, return a list of URLs
 *   4.3 if found none, error out
 */
const addFeedSubscription = createServerFn({
	method: "POST"
})
	.inputValidator(
		v.object({
			feedUrl: v.pipe(v.string(), v.url())
		})
	)
	.handler(async ({ data, signal }) => {
		// 1. Get user ID
		const userId = await getUserId({ signal })
		const db = getDatabase()

		// 2. Create user in DB if it doesn't exist
		db.prepare(`
			INSERT OR IGNORE INTO users (id) VALUES (?)
		`).run(userId)

		// 3. Check if feed exists, create if not
		let feed = db
			.prepare<[url: string], { id: number }>(`
				SELECT id FROM feeds WHERE url = ?
			`)
			.get(data.feedUrl)

		const feedWasCreated = !feed

		if (!feed) {
			const result = db
				.prepare(`
					INSERT INTO feeds (url) VALUES (?)
				`)
				.run(data.feedUrl)
			feed = { id: Number(result.lastInsertRowid) }
		}

		// 4. Add feed to user's subscriptions (if not already subscribed)
		db.prepare(`
			INSERT OR IGNORE INTO subscriptions (user_id, feed_id) VALUES (?, ?)
		`).run(userId, feed.id)

		// 5. Call inngest.send to fetch that feed (if it was just created)
		if (feedWasCreated) {
			await inngest.send({
				name: "feed/parse.requested",
				data: { feedId: feed.id }
			})
		}

		return { success: true, feedId: feed.id }
	})

export const Route = createFileRoute("/")({
	component: HomePage,
	loader: ({ abortController }) => getUserFeeds({ signal: abortController.signal })
})

function HomePage() {
	const feeds = Route.useLoaderData()
	const router = useRouter()

	const handleAddFeed = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		const form = e.currentTarget
		const formData = new FormData(form)
		const feedUrl = formData.get("feedUrl") as string | null

		if (!feedUrl) {
			alert("Please enter a valid feed URL.")
			return
		}

		try {
			await addFeedSubscription({ data: { feedUrl } })
			// Close the dialog
			const dialog = form.closest<HTMLDialogElement>("dialog")
			dialog?.close()
			// Reset form
			form.reset()
			router.invalidate({ filter: (r) => r.routeId === Route.id })
			// // Refresh the page to show new feed
			// window.location.reload()
		} catch (error) {
			console.error("Failed to add feed:", error)
			alert("Failed to add feed. Please check the URL and try again.")
		}
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
							to="/feed/$id"
							params={{ id: feed.id }}
							style={{ display: "flex", gap: "1rem", textDecoration: "none", color: "inherit" }}
						>
							{feed.image_url && <img src={feed.image_url} alt="" className={styles.feedImage} />}
							<div className={styles.feedContent}>
								<h2 className={styles.feedTitle}>{feed.title || "Untitled Feed"}</h2>
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

declare module "react" {
	interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
		commandfor?: string
		command?: "show-modal" | "close" | "toggle-popover" | "hide-popover"
	}
}
