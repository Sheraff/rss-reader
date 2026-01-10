import { type InngestFunction } from "inngest"
import { parseFeed } from "#/inngest/parse-feed"
import { parseArticle } from "#/inngest/parse-article"
import { inngest } from "#/inngest/inngest"

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
export const functions = [helloWorld, goodbyeWorld, parseFeed, parseArticle] satisfies Array<InngestFunction<any, any, any>>