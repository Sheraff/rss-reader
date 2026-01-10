import { HeadContent, Scripts, createRootRoute, useRouter } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"

import appCss from "../styles.css?raw"
import { useState } from "react"
import { useNotifications } from "#/sse/useNotifications"

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8"
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{
				title: "RSS Reader"
			}
		]
	}),
	shellComponent: RootDocument
})

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
				<style dangerouslySetInnerHTML={{ __html: appCss }} />
			</head>
			<body>
				<Notifications />
				{children}
				<TanStackDevtools
					config={{
						position: "bottom-right"
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />
						}
					]}
				/>
				<Scripts />
			</body>
		</html>
	)
}


function Notifications() {
	const router = useRouter()
	const [notifications, setNotifications] = useState<string[]>([])

	// Connect to SSE for real-time notifications
	const { isConnected } = useNotifications({
		onNotification: (notification) => {
			console.log("Received notification:", notification)

			// Handle feed.parsed events
			if (notification.event === "feed.parsed") {
				const data = notification.data as {
					feedId: number
					feedTitle: string
					newArticles: number
					totalItems: number
				}

				if (data.newArticles > 0) {
					const message = `${data.feedTitle}: ${data.newArticles} new article${data.newArticles > 1 ? "s" : ""}`
					setNotifications((prev) => [message, ...prev.slice(0, 4)])

					// Refresh the feed list
					router.invalidate({ filter: (r) => r.routeId === '/' })
				}
			}
		}
	})

	return (
		<>
			{/* SSE connection status indicator */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "0.5rem",
					fontSize: "0.875rem",
					color: isConnected ? "#22c55e" : "#ef4444"
				}}
			>
				<div
					style={{
						width: "8px",
						height: "8px",
						borderRadius: "50%",
						backgroundColor: isConnected ? "#22c55e" : "#ef4444"
					}}
				/>
				{isConnected ? "Live" : "Disconnected"}
			</div>
			{/* Notification toast area */}
			{notifications.length > 0 && (
				<div style={{ marginBottom: "1rem" }}>
					{notifications.map((msg, idx) => (
						<div
							key={idx}
							style={{
								padding: "0.75rem 1rem",
								marginBottom: "0.5rem",
								backgroundColor: "#22c55e",
								color: "white",
								borderRadius: "0.5rem",
								fontSize: "0.875rem",
								animation: "slideIn 0.3s ease-out"
							}}
						>
							🔔 {msg}
						</div>
					))}
				</div>
			)}
		</>
	)
}