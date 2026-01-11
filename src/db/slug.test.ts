import { describe, test, expect, beforeEach, afterEach } from "vitest"
import Database from "better-sqlite3"
import schema from "#/db/schema.sql?raw"
import { generateUniqueSlug } from "./slug"

describe("generateUniqueSlug", () => {
	let db: Database.Database

	beforeEach(() => {
		// Create in-memory database for each test
		db = new Database(":memory:")
		db.pragma("foreign_keys = ON")
		db.exec(schema)
	})

	afterEach(() => {
		db.close()
	})

	describe("title-based slugs", () => {
		test("generates slug from simple title", () => {
			const slug = generateUniqueSlug(db, "Hacker News", "https://news.ycombinator.com/rss")
			expect(slug).toBe("hacker-news")
		})

		test("converts title to lowercase", () => {
			const slug = generateUniqueSlug(db, "TechCrunch", "https://techcrunch.com/feed")
			expect(slug).toBe("techcrunch")
		})

		test("replaces spaces with hyphens", () => {
			const slug = generateUniqueSlug(db, "The Verge", "https://theverge.com/rss")
			expect(slug).toBe("the-verge")
		})

		test("replaces multiple consecutive spaces with single hyphen", () => {
			const slug = generateUniqueSlug(db, "Multiple    Spaces", "https://example.com/feed")
			expect(slug).toBe("multiple-spaces")
		})

		test("removes special characters", () => {
			const slug = generateUniqueSlug(
				db,
				"Hello! World? #Test",
				"https://example.com/feed"
			)
			expect(slug).toBe("hello-world-test")
		})

		test("removes leading and trailing hyphens", () => {
			const slug = generateUniqueSlug(db, "---Test Blog---", "https://example.com/feed")
			expect(slug).toBe("test-blog")
		})

		test("handles unicode characters", () => {
			const slug = generateUniqueSlug(db, "Café Français", "https://example.com/feed")
			expect(slug).toBe("caf-fran-ais")
		})

		test("handles emoji and special unicode", () => {
			const slug = generateUniqueSlug(db, "Tech 🚀 Blog ⭐", "https://example.com/feed")
			expect(slug).toBe("tech-blog")
		})

		test("handles mixed case and symbols", () => {
			const slug = generateUniqueSlug(
				db,
				"My Tech & Code || Blog",
				"https://example.com/feed"
			)
			expect(slug).toBe("my-tech-code-blog")
		})

		test("trims whitespace from title", () => {
			const slug = generateUniqueSlug(db, "  Trimmed Title  ", "https://example.com/feed")
			expect(slug).toBe("trimmed-title")
		})
	})

	describe("URL-based slugs (fallback)", () => {
		test("generates slug from domain when title is null", () => {
			const slug = generateUniqueSlug(db, null, "https://news.ycombinator.com/rss")
			expect(slug).toBe("news-ycombinator-com")
		})

		test("generates slug from domain when title is undefined", () => {
			const slug = generateUniqueSlug(db, undefined, "https://techcrunch.com/feed")
			expect(slug).toBe("techcrunch-com")
		})

		test("generates slug from domain when title is empty string", () => {
			const slug = generateUniqueSlug(db, "", "https://example.com/feed")
			expect(slug).toBe("example-com")
		})

		test("generates slug from domain when title is only whitespace", () => {
			const slug = generateUniqueSlug(db, "   ", "https://example.com/feed")
			expect(slug).toBe("example-com")
		})

		test("removes www prefix from domain", () => {
			const slug = generateUniqueSlug(db, null, "https://www.example.com/feed")
			expect(slug).toBe("example-com")
		})

		test("replaces dots with hyphens in domain", () => {
			const slug = generateUniqueSlug(db, null, "https://blog.example.co.uk/feed")
			expect(slug).toBe("blog-example-co-uk")
		})

		test("handles subdomain in URL", () => {
			const slug = generateUniqueSlug(db, null, "https://feeds.feedburner.com/example")
			expect(slug).toBe("feeds-feedburner-com")
		})

		test("handles invalid URL gracefully", () => {
			const slug = generateUniqueSlug(db, null, "not-a-valid-url")
			expect(slug).toBe("feed")
		})

		test("handles URL with port", () => {
			const slug = generateUniqueSlug(db, null, "https://example.com:8080/feed")
			expect(slug).toBe("example-com")
		})
	})

	describe("length constraints", () => {
		test("truncates long title to 100 characters", () => {
			const longTitle = "a".repeat(150)
			const slug = generateUniqueSlug(db, longTitle, "https://example.com/feed")
			expect(slug).toHaveLength(100)
			expect(slug).toBe("a".repeat(100))
		})

		test("truncates long domain to 100 characters", () => {
			const longDomain = "a".repeat(150)
			const slug = generateUniqueSlug(db, null, `https://${longDomain}.com/feed`)
			expect(slug.length).toBeLessThanOrEqual(100)
		})

		test("handles title that becomes long after converting spaces", () => {
			const title = "word " + "another-word ".repeat(20)
			const slug = generateUniqueSlug(db, title, "https://example.com/feed")
			expect(slug.length).toBeLessThanOrEqual(100)
		})
	})

	describe("uniqueness handling", () => {
		test("returns unique slug when no conflicts", () => {
			const slug = generateUniqueSlug(db, "Unique Blog", "https://example.com/feed")
			expect(slug).toBe("unique-blog")
		})

		test("adds -1 suffix when slug already exists", () => {
			// Insert first feed
			db.prepare("INSERT INTO feeds (url, slug) VALUES (?, ?)").run(
				"https://example1.com/feed",
				"test-blog"
			)

			// Generate slug for second feed with same title
			const slug = generateUniqueSlug(db, "Test Blog", "https://example2.com/feed")
			expect(slug).toBe("test-blog-1")
		})

		test("increments suffix for multiple conflicts", () => {
			// Insert multiple feeds with same base slug
			db.prepare("INSERT INTO feeds (url, slug) VALUES (?, ?)").run(
				"https://example1.com/feed",
				"test-blog"
			)
			db.prepare("INSERT INTO feeds (url, slug) VALUES (?, ?)").run(
				"https://example2.com/feed",
				"test-blog-1"
			)
			db.prepare("INSERT INTO feeds (url, slug) VALUES (?, ?)").run(
				"https://example3.com/feed",
				"test-blog-2"
			)

			// Generate slug for fourth feed
			const slug = generateUniqueSlug(db, "Test Blog", "https://example4.com/feed")
			expect(slug).toBe("test-blog-3")
		})

		test("handles gaps in suffix sequence", () => {
			// Insert feeds with non-sequential suffixes
			db.prepare("INSERT INTO feeds (url, slug) VALUES (?, ?)").run(
				"https://example1.com/feed",
				"test-blog"
			)
			db.prepare("INSERT INTO feeds (url, slug) VALUES (?, ?)").run(
				"https://example2.com/feed",
				"test-blog-2"
			)

			// Should use -1 since it's available
			const slug = generateUniqueSlug(db, "Test Blog", "https://example3.com/feed")
			expect(slug).toBe("test-blog-1")
		})

		test("truncates base slug to make room for suffix", () => {
			const longTitle = "a".repeat(100)
			// Insert first feed with max-length slug
			db.prepare("INSERT INTO feeds (url, slug) VALUES (?, ?)").run(
				"https://example1.com/feed",
				longTitle
			)

			// Generate slug for second feed - should truncate to fit suffix
			const slug = generateUniqueSlug(db, longTitle, "https://example2.com/feed")
			expect(slug.length).toBeLessThanOrEqual(100)
			expect(slug).toMatch(/^a+-1$/)
			expect(slug).toBe("a".repeat(98) + "-1")
		})

		test("handles suffix with longer numbers", () => {
			const title = "a".repeat(100)
			// Create 10 conflicts to get to -10 suffix
			for (let i = 0; i < 10; i++) {
				const suffix = i === 0 ? "" : `-${i}`
				db.prepare("INSERT INTO feeds (url, slug) VALUES (?, ?)").run(
					`https://example${i}.com/feed`,
					`${title.substring(0, 100 - suffix.length)}${suffix}`
				)
			}

			const slug = generateUniqueSlug(db, title, "https://example11.com/feed")
			expect(slug.length).toBeLessThanOrEqual(100)
			expect(slug).toBe("a".repeat(97) + "-10")
		})
	})

	describe("edge cases", () => {
		test("handles title with only special characters", () => {
			const slug = generateUniqueSlug(db, "!@#$%^&*()", "https://example.com/feed")
			expect(slug).toBe("example-com")
		})

		test("handles title that becomes empty after sanitization", () => {
			const slug = generateUniqueSlug(db, "---", "https://example.com/feed")
			expect(slug).toBe("example-com")
		})

		test("handles extremely short title", () => {
			const slug = generateUniqueSlug(db, "X", "https://example.com/feed")
			expect(slug).toBe("x")
		})

		test("handles title with numbers", () => {
			const slug = generateUniqueSlug(db, "Tech 2024 Blog", "https://example.com/feed")
			expect(slug).toBe("tech-2024-blog")
		})

		test("handles title starting and ending with numbers", () => {
			const slug = generateUniqueSlug(db, "2024 Tech Blog 365", "https://example.com/feed")
			expect(slug).toBe("2024-tech-blog-365")
		})

		test("handles URL with path and query params", () => {
			const slug = generateUniqueSlug(
				db,
				null,
				"https://example.com/path/to/feed?key=value"
			)
			expect(slug).toBe("example-com")
		})

		test("handles URL with authentication", () => {
			const slug = generateUniqueSlug(db, null, "https://user:pass@example.com/feed")
			expect(slug).toBe("example-com")
		})

		test("preserves alphanumeric characters", () => {
			const slug = generateUniqueSlug(db, "abc123XYZ", "https://example.com/feed")
			expect(slug).toBe("abc123xyz")
		})

		test("handles consecutive hyphens in original title", () => {
			const slug = generateUniqueSlug(db, "Test--Blog--Title", "https://example.com/feed")
			expect(slug).toBe("test-blog-title")
		})
	})

	describe("real-world examples", () => {
		test("generates slug for Hacker News", () => {
			const slug = generateUniqueSlug(db, "Hacker News", "https://news.ycombinator.com/rss")
			expect(slug).toBe("hacker-news")
		})

		test("generates slug for The Verge", () => {
			const slug = generateUniqueSlug(
				db,
				"The Verge -  All Posts",
				"https://www.theverge.com/rss/index.xml"
			)
			expect(slug).toBe("the-verge-all-posts")
		})

		test("generates slug for Ars Technica", () => {
			const slug = generateUniqueSlug(
				db,
				"Ars Technica",
				"https://feeds.arstechnica.com/arstechnica/index"
			)
			expect(slug).toBe("ars-technica")
		})

		test("generates slug for TechCrunch", () => {
			const slug = generateUniqueSlug(
				db,
				"TechCrunch",
				"https://techcrunch.com/feed/"
			)
			expect(slug).toBe("techcrunch")
		})

		test("generates slug for blog without title", () => {
			const slug = generateUniqueSlug(db, null, "https://blog.example.com/feed.xml")
			expect(slug).toBe("blog-example-com")
		})

		test("generates slug for FeedBurner URL without title", () => {
			const slug = generateUniqueSlug(
				db,
				null,
				"https://feeds.feedburner.com/example-blog"
			)
			expect(slug).toBe("feeds-feedburner-com")
		})
	})
})
