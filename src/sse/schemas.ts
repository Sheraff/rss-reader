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

export const schemas = {
	"feed.parsed": feedParsedSchema,
	"article.parsed": articleParsedSchema
}
