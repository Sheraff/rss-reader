import * as v from "valibot"

const feedParsedSchema = v.object({
	feedId: v.number(),
	feedTitle: v.optional(v.string()),
	newArticles: v.number(),
	totalItems: v.number()
})

export const schemas = {
	"feed.parsed": feedParsedSchema
}
