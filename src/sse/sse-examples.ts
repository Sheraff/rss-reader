/**
 * Example: How to use the SSE notifications in an Inngest function
 */

import { getSSEManager } from "#/sse/sse-manager"

// In any Inngest function, you can send notifications like this:

// Example 1: Notify a specific user about feed parsing completion
export async function notifyUserAboutFeedParse(
	userId: string,
	feedId: number,
	feedTitle: string,
	newArticles: number
) {
	await getSSEManager().notifyUser(userId, "feed.parsed", {
		feedId,
		feedTitle,
		newArticles,
		timestamp: new Date().toISOString()
	})
}

// Example 2: Notify a user about article parsing completion
export async function notifyUserAboutArticleParse(userId: string, articleId: number) {
	await getSSEManager().notifyUser(userId, "article.parsed", {
		articleId,
		timestamp: new Date().toISOString()
	})
}

// Example 3: Broadcast to all connected users
export async function broadcastSystemNotification(message: string) {
	await getSSEManager().broadcast("system.notification", {
		message,
		timestamp: new Date().toISOString()
	})
}

// Example 4: Check if a user is connected before sending
export function canNotifyUser(userId: string): boolean {
	return getSSEManager().isConnected(userId)
}

// Example 5: Get stats about connections
export function getConnectionStats() {
	return {
		totalConnections: getSSEManager().getConnectionCount(),
		connectedUsers: getSSEManager().getConnectedUsers()
	}
}
