import { getDatabase } from "#/db"
import { inngest } from "#/inngest/inngest"

export const scheduleFeedUpdates = inngest.createFunction(
	{
		id: "schedule-feed-updates",
		retries: 3
	},
	{ cron: "0 0 * * *" }, // Run daily at midnight UTC
	async ({ step }) => {
		// Query active feeds that need to be refetched based on TTL
		const feedsIds = await step.run("query-active-feeds", () => {
			const db = getDatabase()
			const feeds = db
				.prepare<[], { id: number }>(`
				SELECT id FROM feeds 
				WHERE is_active = 1 
					AND (
						last_fetched_at IS NULL 
						OR (ttl IS NOT NULL AND datetime(last_fetched_at, '+' || ttl || ' minutes') <= datetime('now'))
						OR (ttl IS NULL AND datetime(last_fetched_at, '+60 minutes') <= datetime('now'))
					)
			`)
				.all()

			return feeds.map((f) => f.id)
		})

		// Schedule parse-feed for each active feed
		await step.sendEvent(
			"schedule-parse-feed",
			feedsIds.map((feedId) => ({
				name: "feed/parse.requested",
				data: {
					feedId
				}
			}))
		)

		return {
			scheduledFeeds: feedsIds.length,
			feedIds: feedsIds
		}
	}
)
