import { useEffect, useState, useCallback, useEffectEvent } from "react"
import * as v from "valibot"

const notificationSchema = v.object({
	event: v.string(),
	data: v.unknown(),
	timestamp: v.string(),
})

export type Notification = v.InferOutput<typeof notificationSchema>

/**
 * React hook to connect to the SSE notifications endpoint
 * Automatically handles reconnection and cleanup
 */
export function useNotifications(options: {
	onNotification: (notification: Notification) => void
	autoReconnect?: boolean
}) {
	const autoReconnect = options.autoReconnect ?? true
	const [isConnected, setIsConnected] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const onNotification = useEffectEvent(options.onNotification)

	const connect = useCallback(() => {
		console.log("[SSE] Connecting to notifications...")
		const eventSource = new EventSource("/api/notifications")

		eventSource.onopen = () => {
			console.log("[SSE] Connected")
			setIsConnected(true)
			setError(null)
		}

		eventSource.onmessage = (event) => {
			console.log('-------SSE-------')
			console.log(event.data)
			console.log('-----------------')
			try {
				const notification = v.parse(
					v.pipe(
						v.string(),
						v.parseJson(),
						notificationSchema
					),
					event.data
				)
				console.log("[SSE] Received:", notification)
				onNotification(notification)
			} catch (err) {
				console.error("[SSE] Failed to parse notification:", err)
			}
		}

		eventSource.onerror = (err) => {
			console.error("[SSE] Connection error:", err)
			setIsConnected(false)
			setError(new Error("SSE connection failed"))
			eventSource.close()

			// Auto-reconnect after 3 seconds
			if (autoReconnect) {
				setTimeout(() => {
					console.log("[SSE] Reconnecting...")
					connect()
				}, 3000)
			}
		}

		return eventSource
	}, [autoReconnect])

	useEffect(() => {
		const eventSource = connect()

		return () => {
			console.log("[SSE] Disconnecting...")
			eventSource.close()
			setIsConnected(false)
		}
	}, [connect])

	return {
		isConnected,
		error
	}
}
