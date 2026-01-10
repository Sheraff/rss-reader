import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { InngestTestEngine } from '@inngest/test'

import Database from 'better-sqlite3'
import schema from '#/db/schema.sql?raw'
import type { Feed, Article } from '#/db/types.ts'
import { parseFeed } from "#/inngest/parse-feed"

// Type guard for serialized error objects
function isErrorLike(value: unknown): value is { message: string } {
	return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string'
}

// Mock RSS feed data
const mockRssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
	<channel>
		<title>Test Blog</title>
		<description>A test blog for RSS parsing</description>
		<link>https://example.com/blog</link>
		<language>en-us</language>
		<lastBuildDate>Fri, 10 Jan 2026 12:00:00 GMT</lastBuildDate>
		<item>
			<title>First Article</title>
			<description>This is the first article</description>
			<link>https://example.com/blog/first-article</link>
			<guid isPermaLink="false">article-1</guid>
			<pubDate>Fri, 10 Jan 2026 10:00:00 GMT</pubDate>
		</item>
		<item>
			<title>Second Article</title>
			<description>This is the second article</description>
			<link>https://example.com/blog/second-article</link>
			<guid isPermaLink="false">article-2</guid>
			<pubDate>Thu, 09 Jan 2026 10:00:00 GMT</pubDate>
		</item>
	</channel>
</rss>`

// Mock database
let testDb: Database.Database

vi.mock('#/db/index.ts', () => ({
	getDatabase: () => testDb,
}))

describe('parseFeed function', () => {
	let feedId: number | bigint
	let t: InngestTestEngine

	beforeEach(() => {
		// Create in-memory database for tests
		testDb = new Database(':memory:')
		testDb.pragma('foreign_keys = ON')
		testDb.exec(schema)

		// Insert a test feed
		const result = testDb.prepare(`
			INSERT INTO feeds (url, type, is_active)
			VALUES (?, ?, ?)
		`).run('https://example.com/feed.xml', 'rss', 1)

		feedId = result.lastInsertRowid

		// Create test engine
		t = new InngestTestEngine({ function: parseFeed })

		// Clear any existing mocks
		vi.restoreAllMocks()
	})

	afterEach(() => {
		// Close database to prevent hanging connections
		if (testDb) {
			testDb.close()
		}
	})

	test('successfully parses RSS feed and inserts articles', async () => {
		// Mock fetch
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => mockRssFeed,
			headers: {
				get: (key: string) => {
					if (key === 'etag') return '"abc123"'
					if (key === 'last-modified') return 'Fri, 10 Jan 2026 12:00:00 GMT'
					return null
				},
			},
		})

		const { result } = await t.execute({
			events: [{ name: 'feed/parse.requested', data: { feedId } }],
			steps: [
				{
					id: 'fan-out-parse-articles',
					handler() {
						// Mock step.sendEvent - no-op in tests
					},
				},
			],
		})

		expect(result).toEqual({
			feedId,
			status: 'success',
			feedTitle: 'Test Blog',
			totalItems: 2,
			newArticles: 2,
		})

		// Verify feed was updated
		const updatedFeed = testDb.prepare<[id: number | bigint], Feed>(`
			SELECT * FROM feeds WHERE id = ?
		`).get(feedId)!

		expect(updatedFeed.title).toBe('Test Blog')
		expect(updatedFeed.description).toBe('A test blog for RSS parsing')
		expect(updatedFeed.link).toBe('https://example.com/blog')
		expect(updatedFeed.language).toBe('en-us')
		expect(updatedFeed.etag).toBe('"abc123"')
		expect(updatedFeed.last_modified_header).toBe('Fri, 10 Jan 2026 12:00:00 GMT')
		expect(updatedFeed.last_fetched_at).toBeTruthy()
		expect(updatedFeed.last_success_at).toBeTruthy()
		expect(updatedFeed.fetch_error_count).toBe(0)

		// Verify articles were inserted
		const articles = testDb.prepare<[feedId: number | bigint], Article>(`
			SELECT * FROM articles WHERE feed_id = ? ORDER BY guid
		`).all(feedId)

		expect(articles).toHaveLength(2)
		expect(articles[0].guid).toBe('article-1')
		expect(articles[0].title).toBe('First Article')
		expect(articles[0].url).toBe('https://example.com/blog/first-article')
		expect(articles[1].guid).toBe('article-2')
		expect(articles[1].title).toBe('Second Article')
	})

	test('handles HTTP 304 Not Modified response', async () => {
		// Set initial etag
		testDb.prepare(`
			UPDATE feeds
			SET etag = ?, last_modified_header = ?
			WHERE id = ?
		`).run('"abc123"', 'Thu, 09 Jan 2026 12:00:00 GMT', feedId)

		// Mock fetch returning 304
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 304,
		})

		const { result } = await t.execute({
			events: [{ name: 'feed/parse.requested', data: { feedId } }],
		})

		expect(result).toEqual({
			feedId,
			status: 'not-modified',
			message: 'Feed has not changed since last fetch',
		})

		// Verify fetch was called with conditional headers
		expect(global.fetch).toHaveBeenCalledWith(
			'https://example.com/feed.xml',
			expect.objectContaining({
				headers: {
					'If-None-Match': '"abc123"',
					'If-Modified-Since': 'Thu, 09 Jan 2026 12:00:00 GMT',
				},
			})
		)

		// Verify last_fetched_at was updated but no articles added
		const feed = testDb.prepare<[id: number | bigint], Feed>(`
			SELECT * FROM feeds WHERE id = ?
		`).get(feedId)!
		expect(feed.last_fetched_at).toBeTruthy()

		const articleCount = testDb.prepare<[feedId: number | bigint], { count: number }>(`
			SELECT COUNT(*) as count FROM articles WHERE feed_id = ?
		`).get(feedId)!
		expect(articleCount.count).toBe(0)
	})

	test('deduplicates articles via unique constraint', async () => {
		// Insert an article first
		testDb.prepare(`
			INSERT INTO articles (feed_id, guid, title)
			VALUES (?, ?, ?)
		`).run(feedId, 'article-1', 'Existing Article')

		// Mock fetch
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => mockRssFeed,
			headers: {
				get: () => null,
			},
		})

		const { result } = await t.execute({
			events: [{ name: 'feed/parse.requested', data: { feedId } }],
			steps: [
				{
					id: 'fan-out-parse-articles',
					handler() {
						// Mock step.sendEvent - no-op in tests
					},
				},
			],
		})

		// Should only insert 1 new article (article-2), article-1 already exists
		expect(result).toEqual({
			feedId,
			status: 'success',
			feedTitle: 'Test Blog',
			totalItems: 2,
			newArticles: 1,
		})

		// Verify only 2 articles total (1 existing + 1 new)
		const articleCount = testDb.prepare<[feedId: number | bigint], { count: number }>(`
			SELECT COUNT(*) as count FROM articles WHERE feed_id = ?
		`).get(feedId)!
		expect(articleCount.count).toBe(2)
	})

	test('throws error when feed not found', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { })

		const { error } = await t.execute({
			events: [{ name: 'feed/parse.requested', data: { feedId: 99999 } }],
		})

		expect(error).toBeDefined()
		expect(isErrorLike(error)).toBe(true)
		if (isErrorLike(error)) {
			expect(error.message).toContain('Feed with id 99999 not found')
		}

		consoleError.mockRestore()
	})

	test('throws error when feed is not active', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { })

		// Set feed to inactive
		testDb.prepare(`
			UPDATE feeds SET is_active = 0 WHERE id = ?
		`).run(feedId)

		const { error } = await t.execute({
			events: [{ name: 'feed/parse.requested', data: { feedId } }],
		})

		expect(error).toBeDefined()
		expect(isErrorLike(error)).toBe(true)
		if (isErrorLike(error)) {
			expect(error.message).toContain('is not active')
		}

		consoleError.mockRestore()
	})

	test('throws error on network failure', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { })

		// Mock fetch throwing network error
		global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

		const { error } = await t.execute({
			events: [{ name: 'feed/parse.requested', data: { feedId } }],
		})

		expect(error).toBeDefined()
		expect(isErrorLike(error)).toBe(true)
		if (isErrorLike(error)) {
			expect(error.message).toContain('Network error')
		}

		consoleError.mockRestore()
	})

	test('throws error on HTTP error response', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { })

		// Mock fetch returning 404
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			statusText: 'Not Found',
		})

		const { error } = await t.execute({
			events: [{ name: 'feed/parse.requested', data: { feedId } }],
		})

		expect(error).toBeDefined()
		expect(isErrorLike(error)).toBe(true)
		if (isErrorLike(error)) {
			expect(error.message).toContain('HTTP 404')
		}

		consoleError.mockRestore()
	})
})
