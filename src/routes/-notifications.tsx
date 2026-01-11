import { createSseClient } from "#/sse/lib/sse-client"
import { useEffect, useState } from "react"
import { schemas } from "#/sse/schemas"
import { useRouter } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import * as v from "valibot"
import { getUserId } from "#/sso/getUserId"
import { getDatabase } from "#/db"
import { inngest } from "#/inngest/inngest"

const styles = {} // Placeholder for CSS Module styles import

type Action =
	| { type: 'feed.add.ambiguous'; data: { candidateUrls: string[]; originalUrl: string; pendingId: number | bigint } }

const selectAmbiguousFeed = createServerFn({
	method: "POST"
})
	.inputValidator(
		v.object({
			feedUrl: v.pipe(v.string(), v.url()),
			pendingId: v.union([v.number(), v.bigint()])
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

		// delete old pending feed
		db.prepare(`DELETE FROM pending_feeds WHERE id = ?`).run(data.pendingId)

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

/**
 * React hook to connect to the SSE notifications endpoint
 * Automatically handles reconnection and cleanup
 */
export function Notifications() {
	const router = useRouter()

	const [actions, setActions] = useState<Action[]>([])

	useEffect(() => {
		const controller = new AbortController()
		const signal = controller.signal
		const sseClient = createSseClient({
			path: "/api/notifications",
			schemas,
			signal
		})
		sseClient.connect()

		const push = (action: Action) => {
			setActions((prev) => [...prev, action])
		}

		sseClient.addEventListener(
			"feed.parsed",
			(event) => {
				const data = event.detail
				if (data.newArticles > 0) {
					router.invalidate({ filter: (r) => r.routeId === "/" })
				}
			},
			{ signal }
		)

		sseClient.addEventListener(
			"feed.add.ambiguous",
			(event) => {
				const data = event.detail
				push({ type: 'feed.add.ambiguous', data })
			},
			{ signal }
		)

		sseClient.addEventListener(
			"feed.add.failed",
			(event) => {
				const data = event.detail
				alert(`Failed to add feed: ${data.error}`)
			},
			{ signal }
		)

		sseClient.addEventListener(
			'article.parsed',
			(event) => {
				const data = event.detail
				router.invalidate({ filter: (r) => r.routeId === `/feed/$slug/` && r.params.slug === data.feedSlug })
				// Invalidate specific article route using slugs from notification
				router.invalidate({
					filter: (r) =>
						r.routeId === `/feed/$slug/$articleSlug` &&
						r.params.slug === data.feedSlug &&
						r.params.articleSlug === data.articleSlug
				})
			},
			{ signal }
		)

		return () => {
			console.log("[SSE] Disconnecting...")
			controller.abort()
		}
	}, [router])

	if (!actions.length) return null

	const [current] = actions

	if (current.type === 'feed.add.ambiguous') {
		const { candidateUrls, originalUrl, pendingId } = current.data
		const handleSelectCandidate = async (selectedUrl: string) => {
			try {
				await selectAmbiguousFeed({ data: { feedUrl: selectedUrl, pendingId } })
				// Remove current action
				setActions((prev) => prev.slice(1))
			} catch (error) {
				console.error("Failed to add selected feed:", error)
				alert("Failed to add feed. Please try again.")
			}
		}
		return (
			<dialog open>
				<div className={styles.dialogContent}>
					<p>Multiple feeds were found for the URL "{originalUrl}". Please select one:</p>
					<ul style={{ listStyle: "none", padding: 0 }}>
						{candidateUrls.map((url) => (
							<li key={url} style={{ marginBottom: "0.5rem" }}>
								<button
									type="button"
									onClick={() => handleSelectCandidate(url)}
									className={styles.submitButton}
									style={{ width: "100%", textAlign: "left" }}
								>
									{url}
								</button>
							</li>
						))}
					</ul>
				</div>
			</dialog>
		)
	}

	throw new Error(`Unknown action type: ${(current as any).type}`)
}
