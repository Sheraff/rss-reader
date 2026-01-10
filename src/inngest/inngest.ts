import { EventSchemas, Inngest } from "inngest"
import * as v from 'valibot'

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
	'article/parse': v.object({
		feedId: v.number(),
		articleId: v.number(),
	}),
})

// Create a client to send and receive events
export const inngest = new Inngest({ id: "rss-reader", schemas })