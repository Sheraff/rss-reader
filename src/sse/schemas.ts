import * as v from "valibot"

const feedParsedSchema = v.object({
	feedId: v.number(),
	feedTitle: v.optional(v.string()),
	newArticles: v.number(),
	totalItems: v.number()
})

const articleParsedSchema = v.object({
	articleId: v.number(),
	feedId: v.number(),
	title: v.optional(v.string()),
	contentLength: v.number()
})

const feedAddedSchema = v.object({
	feedId: v.number(),
	feedUrl: v.string(),
	pendingId: v.union([v.number(), v.bigint()])
})

const feedAddAmbiguousSchema = v.object({
	candidateUrls: v.array(v.string()),
	originalUrl: v.string(),
	pendingId: v.union([v.number(), v.bigint()])
})

const feedAddFailedSchema = v.object({
	error: v.string(),
	originalUrl: v.string(),
	pendingId: v.union([v.number(), v.bigint()])
})

export const schemas = {
	"feed.parsed": feedParsedSchema,
	"article.parsed": articleParsedSchema,
	"feed.added": feedAddedSchema,
	"feed.add.ambiguous": feedAddAmbiguousSchema,
	"feed.add.failed": feedAddFailedSchema
}
