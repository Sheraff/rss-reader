import type Database from "better-sqlite3"

/**
 * Generate a unique URL slug for a feed based on title or URL domain
 * @param db - Database instance
 * @param title - Feed title (optional)
 * @param feedUrl - Feed URL (used as fallback)
 * @returns Unique slug (max 100 chars, alphanumeric + hyphens)
 */
export function generateUniqueSlug(
	db: Database.Database,
	title: string | null | undefined,
	feedUrl: string
): string {
	// Generate base slug from title or URL domain
	let baseSlug: string

	if (title && title.trim()) {
		// Create slug from title: lowercase, replace non-alphanumeric with hyphens
		baseSlug = title
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
			.replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
			.substring(0, 100) // Limit to 100 chars
	} else {
		baseSlug = ""
	}

	// If we don't have a slug from the title, fall back to URL domain
	if (!baseSlug) {
		// Fallback to URL domain
		try {
			const url = new URL(feedUrl)
			baseSlug = url.hostname
				.replace(/^www\./, "") // Remove www prefix
				.replace(/\./g, "-") // Replace dots with hyphens
				.substring(0, 100)
		} catch {
			// Invalid URL, use a generic slug
			baseSlug = "feed"
		}
	}

	// Ensure slug is not empty (final safety check)
	if (!baseSlug) {
		baseSlug = "feed"
	}

	// Check uniqueness and add suffix if needed
	let slug = baseSlug
	let suffix = 0

	while (true) {
		const existing = db
			.prepare<[slug: string], { slug: string }>("SELECT slug FROM feeds WHERE slug = ?")
			.get(slug)

		if (!existing) {
			return slug
		}

		// Slug exists, try with suffix
		suffix++
		const suffixStr = `-${suffix}`
		const maxBaseLength = 100 - suffixStr.length
		slug = baseSlug.substring(0, maxBaseLength) + suffixStr
	}
}
