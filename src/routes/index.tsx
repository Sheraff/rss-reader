import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getDatabase } from "#/db"
import type { FeedWithSubscription } from "#/db/types"
import styles from "./-index.module.css"
import * as v from "valibot"

const getUserFeeds = createServerFn({
	method: "GET"
})
	.inputValidator(
		v.object({
			userId: v.string()
		})
	)
	.handler((ctx) =>
		getDatabase()
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
			.all(ctx.data.userId)
	)

export const Route = createFileRoute("/")({
	component: HomePage,
	loader: ({ context }) => getUserFeeds({ data: { userId: context.userId } }),
})

function HomePage() {
	const feeds = Route.useLoaderData()

	if (feeds.length === 0) {
		return (
			<div className={styles.container}>
				<div className={styles.emptyState}>
					<h1>Welcome to RSS Reader</h1>
					<p>You don't have any feeds yet. Start by subscribing to your first feed!</p>
				</div>
			</div>
		)
	}

	return (
		<div className={styles.container}>
			<h1 className={styles.title}>My Feeds</h1>
			<ul className={styles.feedList}>
				{feeds.map((feed) => (
					<li key={feed.id} className={styles.feedItem}>
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
					</li>
				))}
			</ul>
		</div>
	)
}
