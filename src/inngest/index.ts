import { EventSchemas, Inngest, type InngestFunction } from "inngest"
import * as v from 'valibot'
import { parseFeed } from "#/inngest/parse-feed"

const schemas = new EventSchemas().fromSchema({
	'test/hello.world': v.object({
		email: v.pipe(v.string(), v.email()),
	}),
	'test/goodbye.world': v.object({
		email: v.pipe(v.string(), v.email()),
	}),
	'feed/parse.requested': v.object({
		feedId: v.number(),
	}),
})

// Create a client to send and receive events
export const inngest = new Inngest({ id: "rss-reader", schemas })

const helloWorld = inngest.createFunction(
	{ id: "hello-world" },
	{ event: "test/hello.world" },
	async ({ event, step }) => {
		await step.sleep("wait-a-moment", "1s")
		return { message: `Hello ${event.data.email}!` }
	}
)

const goodbyeWorld = inngest.createFunction(
	{ id: "goodbye-world" },
	{ event: "test/goodbye.world" },
	async ({ event, step }) => {
		await step.sleep("wait-a-moment", "1s")
		return { message: `Goodbye ${event.data.email}!` }
	}
)


// Create an empty array where we'll export future Inngest functions
export const functions = [helloWorld, goodbyeWorld, parseFeed] satisfies Array<InngestFunction<any, any, any>>