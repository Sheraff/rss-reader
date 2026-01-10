import type { EventStream } from "#/sse/event-stream"

/**
 * SSE Connection Manager
 * Manages Server-Sent Event connections for real-time notifications to users
 */
export function getSSEManager(): SSEConnectionManager {
	if (!sseManager) {
		sseManager = createSSEConnectionManager()
	}
	return sseManager
}

interface UserConnection {
	stream: EventStream
	connectedAt: Date
}

type SSEConnectionManager = ReturnType<typeof createSSEConnectionManager>
let sseManager: SSEConnectionManager | null = null

function createSSEConnectionManager() {
	const connections = new Map<string, UserConnection>()

	const manager = {
		/**
		 * Register a new SSE connection for a user
		 */
		addConnection(userId: string, stream: EventStream): void {
			// Close existing connection if any
			manager.removeConnection(userId)

			connections.set(userId, {
				stream,
				connectedAt: new Date()
			})

			console.log(`[SSE] User ${userId} connected. Total connections: ${connections.size}`)
		},

		/**
		 * Remove a user's SSE connection
		 */
		removeConnection(userId: string): void {
			const connection = connections.get(userId)
			if (connection) {
				connections.delete(userId)
				console.log(
					`[SSE] User ${userId} disconnected. Total connections: ${connections.size}`
				)
				if (connections.size === 0) {
					console.log("[SSE] No active connections remaining, closing manager.")
					sseManager = null
				}
			}
		},

		/**
		 * Send a notification to a specific user
		 */
		async notifyUser<K extends keyof EventSourceEventMap & string>(userId: string, event: K, data: EventSourceEventMap[K] extends MessageEvent<infer D> ? D : unknown): Promise<boolean> {
			console.warn(`[SSE] Notifying user ${userId} with event ${event}`)
			const connection = connections.get(userId)
			if (!connection) {
				console.log(`[SSE] No active connection for user ${userId}`)
				return false
			}

			try {
				await connection.stream.push({ event, data: JSON.stringify(data) })
				console.log(`[SSE] Sent ${event} to user ${userId}`)
				return true
			} catch (error) {
				console.error(`[SSE] Error sending to user ${userId}:`, error)
				manager.removeConnection(userId)
				return false
			}
		},

		/**
		 * Broadcast a message to all connected users
		 */
		async broadcast<K extends keyof EventSourceEventMap & string>(event: K, data: EventSourceEventMap[K] extends MessageEvent<infer D> ? D : unknown): Promise<number> {
			let sent = 0
			const string = JSON.stringify(data)
			for (const [userId, connection] of connections) {
				try {
					await connection.stream.push({ event, data: string })
					sent++
				} catch (error) {
					console.error(`[SSE] Error broadcasting to user ${userId}:`, error)
					manager.removeConnection(userId)
				}
			}

			console.log(`[SSE] Broadcast ${event} to ${sent}/${connections.size} users`)
			return sent
		},

		/**
		 * Get the number of active connections
		 */
		getConnectionCount(): number {
			return connections.size
		},

		/**
		 * Check if a user has an active connection
		 */
		isConnected(userId: string): boolean {
			return connections.has(userId)
		},

		/**
		 * Get all connected user IDs
		 */
		getConnectedUsers(): string[] {
			return Array.from(connections.keys())
		},
	}

	return manager
}