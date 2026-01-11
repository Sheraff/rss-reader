import { createFileRoute } from "@tanstack/react-router"
import { getUserId } from "#/sso/getUserId"
import { getSSEManager } from "#/sse/sse-manager"
import { EventStream } from "#/sse/lib/event-stream"

/**
 * Server-Sent Events endpoint for real-time notifications
 * Each authenticated user gets a persistent connection to receive updates
 * about their feed parsing, article updates, etc.
 */
export const Route = createFileRoute("/api/notifications")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          // Get authenticated user ID
          const userId = await getUserId({ signal: request.signal })

          // Create event stream
          const eventStream = new EventStream(request)

          // Clean up on disconnect
          eventStream.onClosed(async () => {
            getSSEManager().removeConnection(userId)
            await eventStream.close()
          })

          // Register connection
          getSSEManager().addConnection(userId, eventStream)

          // Return immediately with the readable stream
          // The initial message will be flushed as soon as the client starts reading
          return eventStream.response()
        } catch (error) {
          console.error("[SSE] Connection error:", error)
          return new Response("Unauthorized", { status: 401 })
        }
      }
    }
  }
})
