import { createSseClient } from "#/sse/lib/sse-client"
import { useEffect } from "react"
import { schemas } from "#/sse/schemas"
import { useRouter } from "@tanstack/react-router"

/**
 * React hook to connect to the SSE notifications endpoint
 * Automatically handles reconnection and cleanup
 */
export function useNotifications() {
	const router = useRouter()

	useEffect(() => {
		const controller = new AbortController()
		const signal = controller.signal
		const sseClient = createSseClient({
			path: "/api/notifications",
			schemas,
			signal
		})
		sseClient.connect()
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
		return () => {
			console.log("[SSE] Disconnecting...")
			controller.abort()
		}
	}, [])
}
