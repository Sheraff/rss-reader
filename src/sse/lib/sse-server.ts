import * as v from "valibot"
import type { EventStream } from "#/sse/lib/event-stream"
import { serialize } from "seroval"

interface UserConnection {
	stream: EventStream
	connectedAt: Date
}

export type SSEServer<Schemas extends Record<string, v.BaseSchema<any, any, any>>> = ReturnType<
	typeof createSseServer<Schemas>
>

export function createSseServer<Schemas extends Record<string, v.BaseSchema<any, any, any>>>({
	schemas
}: {
	schemas: Schemas
}) {
	if (schemas.error || schemas.message || schemas.open || schemas.close) {
		throw new Error("Schemas cannot define reserved event names: error, message, open, close")
	}

	type EventMap = {
		[K in keyof Schemas]: v.InferOutput<Schemas[K]>
	}

	const validators = Object.fromEntries(
		Object.entries(schemas).map(([event, schema]) => [
			event,
			(data: unknown) => v.safeParse(schema, data)
		])
	)

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

			// Queue initial message to ensures request doesn't remain pending and headers are sent
			stream.push('ping').catch(console.error)

			console.log(`[SSE] User ${userId} connected. Total connections: ${connections.size}`)
		},

		/**
		 * Remove a user's SSE connection
		 */
		removeConnection(userId: string): void {
			const connection = connections.get(userId)
			if (connection) {
				connections.delete(userId)
				console.log(`[SSE] User ${userId} disconnected. Total connections: ${connections.size}`)
			}
		},

		/**
		 * Send a notification to a specific user
		 */
		async notifyUser<K extends keyof EventMap & string>(
			userId: string,
			event: K,
			data: EventMap[K]
		): Promise<boolean> {
			console.warn(`[SSE] Notifying user ${userId} with event ${event}`)

			const parsed = validators[event](data)
			if (!parsed.success) {
				console.error(`[SSE] Validation failed for event ${event}:`, parsed.issues)
				return false
			}

			const connection = connections.get(userId)
			if (!connection) {
				console.log(`[SSE] No active connection for user ${userId}`)
				return false
			}

			try {
				await connection.stream.push({ event, data: serialize(parsed.output) })
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
		async broadcast<K extends keyof EventMap & string>(
			event: K,
			data: EventMap[K]
		): Promise<number> {
			const parsed = validators[event](data)
			if (!parsed.success) {
				console.error(`[SSE] Validation failed for event ${event}:`, parsed.issues)
				return 0
			}

			let sent = 0
			const string = serialize(parsed.output)
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
		}
	}

	return manager
}
