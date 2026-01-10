import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"

import appCss from "../styles.css?raw"
import { getUserId } from "#/sso/getUserId"

export const Route = createRootRoute({
	beforeLoad: async ({ abortController }) => {
		// just an auth check, not using the result here
		await getUserId({ signal: abortController.signal })
	},
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
