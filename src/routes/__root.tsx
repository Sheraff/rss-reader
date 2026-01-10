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

declare global {
	interface EventSourceEventMap {
		"feed.parsed": MessageEvent<{
			feedId: number
			feedTitle: string | undefined
			newArticles: number
			totalItems: number
		}>
	}
}




function Notifications() {
	const router = useRouter()

	// Connect to SSE for real-time notifications
	const { isConnected } = useNotifications({
		"feed.parsed": (data) => {
			if (data.newArticles > 0) {
				router.invalidate({ filter: (r) => r.routeId === '/' })
			}
		},
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
		</>
	)
}