import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { InngestTestEngine } from "@inngest/test"

import Database from "better-sqlite3"
import schema from "#/db/schema.sql?raw"
import { scheduleFeedUpdates } from "#/inngest/schedule-feed-updates"

// Mock database
let testDb: Database.Database

vi.mock("#/db/index.ts", () => ({
	getDatabase: () => testDb
}))

describe("scheduleFeedUpdates function", () => {
	let t: InngestTestEngine

	beforeEach(() => {
		// Create in-memory test database with schema
		testDb = new Database(":memory:")
		testDb.exec(schema)

		// Create test engine
		t = new InngestTestEngine({
			function: scheduleFeedUpdates
		})
	})

	afterEach(() => {
		testDb.close()
	})

	// Note: Tests that send events fail due to Inngest test engine requiring API key in test mode
	// The function is straightforward - it queries active feeds and sends events
	// We test the edge cases (empty results) which work fine
	test("should schedule parse-feed for all active feeds", async () => {
		// Insert test feeds - some active, some inactive
		testDb
			.prepare(`
			INSERT INTO feeds (url, title, description, is_active, fetch_error_count, ttl)
			VALUES (?, ?, ?, ?, ?, ?)
		`)
			.run("https://example.com/feed1.xml", "Feed 1", "Description 1", 1, 0, 60)

		testDb
			.prepare(`
			INSERT INTO feeds (url, title, description, is_active, fetch_error_count, ttl)
			VALUES (?, ?, ?, ?, ?, ?)
		`)
			.run("https://example.com/feed2.xml", "Feed 2", "Description 2", 1, 0, 30)

		testDb
			.prepare(`
			INSERT INTO feeds (url, title, description, is_active, fetch_error_count, ttl)
			VALUES (?, ?, ?, ?, ?, ?)
		`)
			.run("https://example.com/feed3.xml", "Feed 3", "Description 3", 0, 0, 60) // Inactive

		testDb
			.prepare(`
			INSERT INTO feeds (url, title, description, is_active, fetch_error_count, ttl)
			VALUES (?, ?, ?, ?, ?, ?)
		`)
			.run("https://example.com/feed4.xml", "Feed 4", "Description 4", 1, 0, null)

		// Execute the cron function with mocked step
		const { result } = await t.execute({
			steps: [
				{
					id: "schedule-parse-feed",
					handler() {
						// Mock step.sendEvent - no-op in tests
					}
				}
			]
		})

		// Should have scheduled 3 active feeds (feed1, feed2, feed4)
		expect(result).toMatchObject({
			scheduledFeeds: 3,
			feedIds: expect.arrayContaining([1, 2, 4])
		})
		expect(result).toMatchObject({
			feedIds: expect.not.arrayContaining([3]) // Inactive feed should not be scheduled
		})
	})

	test("should send correct event payload for each feed", async () => {
		// Insert a single test feed
		testDb
			.prepare(`
			INSERT INTO feeds (url, title, description, is_active, fetch_error_count)
			VALUES (?, ?, ?, ?, ?)
		`)
			.run("https://example.com/feed.xml", "Test Feed", "Description", 1, 0)

		// Execute the function with mocked step
		const { result } = await t.execute({
			steps: [
				{
					id: "schedule-parse-feed",
					handler() {
						// Mock step.sendEvent - no-op in tests
					}
				}
			]
		})
		// Should have scheduled 1 feed with correct ID
		expect(result).toMatchObject({
			scheduledFeeds: 1,
			feedIds: [1]
		})
	})

	test("should handle no active feeds gracefully", async () => {
		// Insert only inactive feeds
		testDb
			.prepare(`
			INSERT INTO feeds (url, title, description, is_active, fetch_error_count)
			VALUES (?, ?, ?, ?, ?)
		`)
			.run("https://example.com/feed.xml", "Inactive Feed", "Description", 0, 0)

		// Execute the function
		const { result } = await t.execute()

		// Should schedule zero feeds
		expect(result).toMatchObject({
			scheduledFeeds: 0,
			feedIds: []
		})
	})

	test("should handle empty database gracefully", async () => {
		// Don't insert any feeds

		// Execute the function
		const { result } = await t.execute()

		// Should schedule zero feeds
		expect(result).toMatchObject({
			scheduledFeeds: 0,
			feedIds: []
		})
	})

	test("should respect TTL when scheduling feeds", async () => {
		// Insert feeds with various states
		const now = new Date().toISOString()
		const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

		// Recently fetched feed with long TTL (not yet expired) - should NOT be scheduled
		testDb
			.prepare(`
			INSERT INTO feeds (url, title, description, is_active, fetch_error_count, ttl, last_fetched_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`)
			.run("https://example.com/feed1.xml", "Feed 1", "Description 1", 1, 0, 120, now)

		// Old fetch with expired TTL - should be scheduled
		testDb
			.prepare(`
			INSERT INTO feeds (url, title, description, is_active, fetch_error_count, ttl, last_fetched_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`)
			.run("https://example.com/feed2.xml", "Feed 2", "Description 2", 1, 0, 30, hourAgo)

		// Never fetched - should be scheduled
		testDb
			.prepare(`
			INSERT INTO feeds (url, title, description, is_active, fetch_error_count)
			VALUES (?, ?, ?, ?, ?)
		`)
			.run("https://example.com/feed3.xml", "Feed 3", "Description 3", 1, 0)

		// Execute the function with mocked step
		const { result } = await t.execute({
			steps: [
				{
					id: "schedule-parse-feed",
					handler() {
						// Mock step.sendEvent - no-op in tests
					}
				}
			]
		})

		// Only feeds 2 and 3 should be scheduled (feed 1's TTL hasn't expired)
		expect(result).toMatchObject({
			scheduledFeeds: 2,
			feedIds: expect.arrayContaining([2, 3])
		})
		expect(result).toMatchObject({
			feedIds: expect.not.arrayContaining([1]) // Feed 1 should not be scheduled
		})
	})
})
