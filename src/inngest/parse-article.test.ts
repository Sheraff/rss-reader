import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { InngestTestEngine } from '@inngest/test'

import Database from 'better-sqlite3'
import schema from '#/db/schema.sql?raw'
import type { Article } from '#/db/types.ts'
import { parseArticle } from "#/inngest/parse-article"

// Mock database
let testDb: Database.Database

vi.mock('#/db/index.ts', () => ({
	getDatabase: () => testDb,
}))

// Import after mocking

// Type guard for serialized error objects
function isErrorLike(value: unknown): value is { message: string } {
	return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string'
}

// Mock HTML article with readable content
const mockArticleHtml = `
<!DOCTYPE html>
<html>
<head>
	<title>Test Article Title</title>
</head>
<body>
	<article>
		<header>
			<h1>Test Article Title</h1>
			<p class="byline">By John Doe</p>
			<time datetime="2026-01-10">January 10, 2026</time>
		</header>
		<div class="content">
			<p>This is the first paragraph of the article content.</p>
			<p>This is the second paragraph with more detailed information.</p>
			<p>This is the third paragraph to make it substantial.</p>
		</div>
	</article>
</body>
</html>
`

describe('parseArticle function', () => {
	let feedId: number | bigint
	let articleId: number | bigint
	let t: InngestTestEngine

	beforeEach(() => {
		// Create in-memory database for tests
		testDb = new Database(':memory:')
		testDb.pragma('foreign_keys = ON')
		testDb.exec(schema)

		// Insert a test feed
		const feedResult = testDb.prepare(`
			INSERT INTO feeds (url, type, is_active)
			VALUES (?, ?, ?)
		`).run('https://example.com/feed.xml', 'rss', 1)
		feedId = feedResult.lastInsertRowid

		// Insert a test article
		const articleResult = testDb.prepare(`
			INSERT INTO articles (feed_id, guid, title, url, content, fetch_status)
			VALUES (?, ?, ?, ?, ?, ?)
		`).run(
			feedId,
			'article-1',
			'Test Article',
			'https://example.com/article',
			'<p>Short RSS content</p>',
			'none'
		)
		articleId = articleResult.lastInsertRowid

		// Create test engine
		t = new InngestTestEngine({ function: parseArticle })

		// Clear any existing mocks
		vi.restoreAllMocks()
	})

	afterEach(() => {
		// Close database to prevent hanging connections
		if (testDb) {
			testDb.close()
		}
	})

	test('successfully fetches and parses article content', async () => {
		// Mock fetch
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => mockArticleHtml,
		})

		const { result } = await t.execute({
			events: [{ name: 'article/parse', data: { feedId, articleId } }],
		})

		expect(result).toMatchObject({
			articleId,
			feedId,
			status: 'success',
			title: 'Test Article Title',
			contentLength: expect.any(Number),
		})

		// Verify fetch was called with proper headers
		expect(global.fetch).toHaveBeenCalledWith(
			'https://example.com/article',
			expect.objectContaining({
				headers: {
					'User-Agent': 'RSS-Reader/1.0',
					'Accept': 'text/html,application/xhtml+xml',
				},
				redirect: 'follow',
			})
		)

		// Verify article was updated in database
		const updatedArticle = testDb.prepare<[id: number | bigint], Article>(`
			SELECT * FROM articles WHERE id = ?
		`).get(articleId)!

		expect(updatedArticle.fetch_status).toBe('complete')
		expect(updatedArticle.content).toBeTruthy()
		expect(updatedArticle.content).toContain('first paragraph')
		expect(updatedArticle.content).not.toBe('<p>Short RSS content</p>')
	})

	test('stores extracted metadata from Readability', async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => mockArticleHtml,
		})

		await t.execute({
			events: [{ name: 'article/parse', data: { feedId, articleId } }],
		})

		const updatedArticle = testDb.prepare<[id: number | bigint], Article>(`
			SELECT * FROM articles WHERE id = ?
		`).get(articleId)!

		// Should have extracted byline (includes "By " prefix in this case)
		expect(updatedArticle.author_name).toBe('By John Doe')
		expect(updatedArticle.fetch_status).toBe('complete')
	})

	test('preserves RSS data with COALESCE when Readability returns null', async () => {
		// Update article with RSS data
		testDb.prepare(`
			UPDATE articles
			SET author_name = ?, summary = ?, source_title = ?, published_at = ?
			WHERE id = ?
		`).run('RSS Author', 'RSS Summary', 'RSS Source', '2026-01-09T12:00:00Z', articleId)

		// Mock HTML without extractable metadata
		const minimalHtml = `
			<!DOCTYPE html>
			<html><body><p>Just some text.</p></body></html>
		`

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => minimalHtml,
		})

		await t.execute({
			events: [{ name: 'article/parse', data: { feedId, articleId } }],
		})

		const updatedArticle = testDb.prepare<[id: number | bigint], Article>(`
			SELECT * FROM articles WHERE id = ?
		`).get(articleId)!

		// Readability extracted some values from the minimal HTML
		// COALESCE only preserves when Readability returns null, not when it returns a value
		expect(updatedArticle.author_name).toBe('RSS Author') // Readability found no author
		expect(updatedArticle.summary).toBe('Just some text.') // Readability extracted excerpt
		expect(updatedArticle.source_title).toBe('RSS Source') // Readability found no site name
		expect(updatedArticle.published_at).toBe('2026-01-09T12:00:00Z') // Readability found no date
		expect(updatedArticle.fetch_status).toBe('complete')
	})

	test('throws error when article not found', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { })

		const { error } = await t.execute({
			events: [{ name: 'article/parse', data: { feedId, articleId: 99999 } }],
		})

		expect(error).toBeDefined()
		expect(isErrorLike(error)).toBe(true)
		if (isErrorLike(error)) {
			expect(error.message).toContain('Article with id 99999 not found')
		}

		consoleError.mockRestore()
	})

	test('throws error when article has no URL', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { })

		// Update article to have no URL
		testDb.prepare(`
			UPDATE articles SET url = NULL WHERE id = ?
		`).run(articleId)

		const { error } = await t.execute({
			events: [{ name: 'article/parse', data: { feedId, articleId } }],
		})

		expect(error).toBeDefined()
		expect(isErrorLike(error)).toBe(true)
		if (isErrorLike(error)) {
			expect(error.message).toContain('has no URL to fetch')
		}

		consoleError.mockRestore()
	})

	test('throws error on network failure', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { })

		// Mock fetch throwing network error
		global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

		const { error } = await t.execute({
			events: [{ name: 'article/parse', data: { feedId, articleId } }],
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
			events: [{ name: 'article/parse', data: { feedId, articleId } }],
		})

		expect(error).toBeDefined()
		expect(isErrorLike(error)).toBe(true)
		if (isErrorLike(error)) {
			expect(error.message).toContain('HTTP 404')
		}

		consoleError.mockRestore()
	})

	test('throws error when Readability fails to parse', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { })

		// Mock HTML that Readability can't parse
		const unparsableHtml = '<html><body></body></html>'

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => unparsableHtml,
		})

		const { error } = await t.execute({
			events: [{ name: 'article/parse', data: { feedId, articleId } }],
		})

		expect(error).toBeDefined()
		expect(isErrorLike(error)).toBe(true)
		if (isErrorLike(error)) {
			expect(error.message).toContain('Failed to extract article content')
		}

		consoleError.mockRestore()
	})
})
