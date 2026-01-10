import { redirect } from "@tanstack/react-router"
import { COOKIE_NAME, createSsoClient } from "@sso/client"

import { createServerFn } from "@tanstack/react-start"
import { getCookie } from "@tanstack/react-start/server"
import * as v from "valibot"

const ssoClient = process.env.NODE_ENV === "production" ? createSsoClient("foo") : null

export const getUserId = createServerFn({ method: "GET" })
	.inputValidator(
		v.optional(
			v.object({
				path: v.optional(v.string())
			})
		)
	)
	.handler(async ({ signal, data }) => {
		if (!ssoClient) return "test" // Dev mode: skip auth
		const auth = await ssoClient.checkAuth(
			getCookie(COOKIE_NAME),
			"rss.florianpellet.com",
			data?.path ?? "/",
			signal
		)
		if (auth.authenticated) return auth.user_id
		throw redirect({ href: auth.redirect })
	})
