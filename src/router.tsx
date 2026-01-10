import { createRouter } from "@tanstack/react-router"

// Import the generated route tree
import { routeTree } from "./routeTree.gen"

// Create a new router instance
export const getRouter = () =>
	createRouter({
		routeTree,
		context: {},
		scrollRestoration: true,
		defaultPreloadStaleTime: 30_000,
		defaultPreload: 'intent',
		defaultNotFoundComponent: () => <div>404 - Page Not Found</div>
	})
