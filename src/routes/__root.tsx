import { HeadContent, Scripts, createRootRoute, redirect } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { COOKIE_NAME, createSsoClient } from "@sso/client"

import appCss from "../styles.css?raw"
import { createServerFn } from "@tanstack/react-start"
import { getCookie } from "@tanstack/react-start/server"

const ssoClient = process.env.NODE_ENV === "production" ? createSsoClient("foo") : null

const authProtected = createServerFn({ method: "GET" }).handler(async ({ signal }) => {
	if (!ssoClient) return { userId: "test" } // Dev mode: skip auth
	const auth = await ssoClient.checkAuth(
		getCookie(COOKIE_NAME),
		"rss.florianpellet.com",
		"/",
		signal
	)
	if (auth.authenticated) return { userId: auth.user_id }
	throw redirect({ href: auth.redirect })
})

export const Route = createRootRoute({
	beforeLoad: ({ abortController }) => authProtected({ signal: abortController.signal }),
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
