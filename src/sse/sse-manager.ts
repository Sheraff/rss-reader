import { schemas } from "#/sse/schemas"
import { createSseServer, type SSEServer } from "#/sse/lib/sse-server"

/**
 * SSE Connection Manager
 * Manages Server-Sent Event connections for real-time notifications to users
 */
export function getSSEManager(): SSEServer<typeof schemas> {
	if (!sseManager) {
		sseManager = createSseServer({ schemas })
	}
	return sseManager
}

let sseManager: SSEServer<typeof schemas> | null = null
