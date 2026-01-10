import { useEffect, useState, useCallback, useRef } from "react"
import * as v from "valibot"

const notificationSchema = v.object({
	event: v.string(),
	data: v.unknown(),
	timestamp: v.string(),
})

export type Notification = v.InferOutput<typeof notificationSchema>

type Callbacks = {
	[K in keyof EventSourceEventMap & string]?: EventSourceEventMap[K] extends MessageEvent<infer D>
	? (data: D) => void
	: never
}

/**
 * React hook to connect to the SSE notifications endpoint
 * Automatically handles reconnection and cleanup
 */
export function useNotifications(callbacks: Callbacks, options?: { autoReconnect?: boolean }) {
	const autoReconnect = options?.autoReconnect ?? true
	const [isConnected, setIsConnected] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const stableCallbacks = useRef(callbacks)

	const connect = useCallback(() => {
		console.log("[SSE] Connecting to notifications...")
		const eventSource = new EventSource("/api/notifications")
		const controller = new AbortController()
		const callbacks = stableCallbacks.current

		const close = () => {
			console.log("[SSE] Closing connection...")
			eventSource.close()
			setIsConnected(false)
			controller.abort()
		}

		eventSource.onopen = () => {
			console.log("[SSE] Streaming...")
		}

		eventSource.addEventListener('connected', (event) => {
			console.log(`[SSE] Connected as ${JSON.parse(event.data).userId}`)
			setIsConnected(true)
			setError(null)
		}, { once: true, signal: controller.signal })

		eventSource.onmessage = (event) => {
			console.warn("[SSE] Unlabeled event:", event.data)
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

		for (const eventName in callbacks) {
			eventSource.addEventListener(eventName, (event) => {
				const callback = callbacks[eventName as keyof typeof callbacks]
				if (!callback) return
				try {
					const data = (event as MessageEvent).data
					callback(JSON.parse(data))
				} catch (err) {
					console.error(`[SSE] Failed to parse ${eventName} event:`, err)
				}
			}, { signal: controller.signal })
		}

		return { close }
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
