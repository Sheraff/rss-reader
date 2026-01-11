import { getDatabase } from "#/db"
import { inngest } from "#/inngest/inngest"
import { NonRetriableError, RetryAfterError } from "inngest"
import Parser from "rss-parser"
import { parseHTML } from "linkedom"
import { getSSEManager } from "#/sse/sse-manager"

export const addFeed = inngest.createFunction(
	{
		id: "add-feed",
		retries: 3,
		concurrency: 1
	},
	{ event: "feed/add.requested" },
	async ({ event, step }) => {
		const { feedUrl, requestedBy, pendingId } = event.data

		// Step 1: Check if feed already exists
		const existingFeed = await step.run("check-existing-feed", () => {
			const db = getDatabase()
			const feed = db
				.prepare<[url: string], { id: number }>(`
					SELECT id FROM feeds WHERE url = ?
				`)
				.get(feedUrl)
			return feed
		})

		if (existingFeed) {
			// Feed already exists, update pending status and notify
			await step.run("mark-pending-completed", () => {
				const db = getDatabase()
				db.prepare(`DELETE FROM pending_feeds WHERE id = ?`).run(pendingId)
				db.prepare(`
					INSERT OR IGNORE INTO subscriptions (user_id, feed_id) VALUES (?, ?)
				`).run(requestedBy, existingFeed.id)
			})

			await step.run("notify-feed-exists", async () => {
				await getSSEManager().notifyUser(requestedBy, "feed.added", {
					feedId: existingFeed.id,
					feedUrl,
					pendingId
				})
			})

			return { feedId: existingFeed.id, alreadyExisted: true }
		}

		// Step 2: Fetch the URL with timeout
		const fetchResult = await step.run("fetch-url", async () => {
			const response = await fetch(feedUrl, {
				headers: {
					"User-Agent": "RSS-Reader/1.0"
				},
				signal: AbortSignal.timeout(30_000)
			})

			if (response.status === 429 && response.headers.get("Retry-After")) {
				const retryAfter = parseInt(response.headers.get("Retry-After")!, 10)
				throw new RetryAfterError(`Rate limited. Retry after ${retryAfter} seconds.`, retryAfter)
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			const contentType = response.headers.get("content-type") || ""
			const text = await response.text()

			return { text, contentType }
		})

		// Step 3: Try to parse as RSS/Atom feed
		const rssParseResult = await step.run("validate-rss", async () => {
			const parser = new Parser()
			try {
				const parsed = await parser.parseString(fetchResult.text)
				return { isValid: true as const, parsed }
			} catch (error) {
				return { isValid: false as const, error: error instanceof Error ? error.message : String(error) }
			}
		})

		// If it's valid RSS, create the feed
		if (rssParseResult.isValid) {
			const feedId = await step.run("create-feed-from-rss", () => {
				const db = getDatabase()
				db
					.prepare(`
						INSERT OR IGNORE INTO feeds (url, type, title, description, link)
						VALUES (?, ?, ?, ?, ?)
					`)
					.run(
						feedUrl,
						rssParseResult.parsed.feedUrl || rssParseResult.parsed.link ? "rss" : "atom",
						rssParseResult.parsed.title || null,
						rssParseResult.parsed.description || null,
						rssParseResult.parsed.link || null
					)
				const result = db.prepare<[url: string], { id: number }>(`SELECT id FROM feeds WHERE url = ?`).get(feedUrl)
				if (!result) throw new Error("Failed to create feed")

				const feedId = result.id

				// Update pending status
				db.prepare(`DELETE FROM pending_feeds WHERE id = ?`).run(pendingId)
				db.prepare(`
					INSERT OR IGNORE INTO subscriptions (user_id, feed_id) VALUES (?, ?)
				`).run(requestedBy, feedId)

				return feedId
			})

			await step.run("notify-feed-created", async () => {
				await getSSEManager().notifyUser(requestedBy, "feed.added", {
					feedId,
					feedUrl,
					pendingId
				})
			})

			// Trigger feed parsing
			await step.sendEvent("trigger-feed-parse", {
				name: "feed/parse.requested",
				data: { feedId }
			})

			return { feedId, created: true }
		}

		// Step 4: Not valid RSS, search for RSS feed links in HTML
		const discoveredFeeds = await step.run("discover-rss-feeds", () => {
			const { document } = parseHTML(fetchResult.text)
			const candidateUrls = new Set<string>()

			for (const link of document.querySelectorAll('link[rel="alternate"]')) {
				const type = link.getAttribute("type")
				const href = link.getAttribute("href")

				if (
					href &&
					(type === "application/rss+xml" ||
						type === "application/atom+xml" ||
						type === "application/xml" ||
						type === "text/xml")
				) {
					// Resolve absolute URLs
					try {
						const absoluteUrl = new URL(feedUrl).toString()
						candidateUrls.add(absoluteUrl)
						continue
					} catch {
						// Invalid URL, skip
					}

					// Resolve relative URLs
					try {
						const absoluteUrl = new URL(href, feedUrl).toString()
						candidateUrls.add(absoluteUrl)
						continue
					} catch {
						// Invalid URL, skip
					}
				}
			}

			for (const a of document.querySelectorAll("a[href]")) {
				const href = a.getAttribute("href")
				if (href && (href.endsWith(".rss") || href.endsWith(".xml"))) {
					// Resolve absolute URLs
					try {
						const absoluteUrl = new URL(href).toString()
						candidateUrls.add(absoluteUrl)
						continue
					} catch {
						// Invalid URL, skip
					}
					// Resolve relative URLs
					try {
						const absoluteUrl = new URL(href, feedUrl).toString()
						candidateUrls.add(absoluteUrl)
						continue
					} catch {
						// Invalid URL, skip
					}
				}
			}

			return Array.from(candidateUrls)
		})

		if (discoveredFeeds.length === 0) {
			// No feeds found, mark as failed
			await step.run("mark-failed-no-feeds", () => {
				const db = getDatabase()
				db.prepare(`
					UPDATE pending_feeds
					SET status = 'failed', error_message = ?
					WHERE id = ?
				`).run("URL is not a valid RSS/Atom feed and no feed links were found", pendingId)
			})

			await step.run("notify-failed", async () => {
				await getSSEManager().notifyUser(requestedBy, "feed.add.failed", {
					error: "URL is not a valid RSS/Atom feed and no feed links were found",
					originalUrl: feedUrl,
					pendingId
				})
			})

			throw new NonRetriableError("No RSS feeds found")
		}

		// Step 5: Validate discovered feed URLs
		const parser = new Parser()
		const allFeeds = await Promise.all(
			discoveredFeeds.map((url) => step.run("validate-discovered-feeds", async () => {
				const response = await fetch(url, {
					headers: { "User-Agent": "RSS-Reader/1.0" },
					signal: AbortSignal.timeout(10_000)
				})

				if (response.status === 429 && response.headers.get("Retry-After")) {
					const retryAfter = parseInt(response.headers.get("Retry-After")!, 10)
					throw new RetryAfterError(`Rate limited. Retry after ${retryAfter} seconds.`, retryAfter)
				}

				if (response.ok) {
					const text = await response.text()
					try {
						await parser.parseString(text)
						return url
					} catch {
						// Invalid feed, skip
					}
				}
			}))
		)
		const validatedFeeds = allFeeds.filter(Boolean)

		if (validatedFeeds.length === 0) {
			// Found links but none were valid
			await step.run("mark-failed-invalid-feeds", () => {
				const db = getDatabase()
				db.prepare(`
					UPDATE pending_feeds
					SET status = 'failed', error_message = ?
					WHERE id = ?
				`).run("Found feed links but none were valid RSS/Atom feeds", pendingId)
			})

			await step.run("notify-failed-invalid", async () => {
				await getSSEManager().notifyUser(requestedBy, "feed.add.failed", {
					error: "Found feed links but none were valid RSS/Atom feeds",
					originalUrl: feedUrl,
					pendingId
				})
			})

			throw new NonRetriableError("No valid RSS feeds found")
		}

		if (validatedFeeds.length === 1) {
			// Single feed found, create it automatically
			const discoveredUrl = validatedFeeds[0]

			// Check if this URL already exists
			const existingDiscoveredFeed = await step.run("check-discovered-feed-exists", () => {
				const db = getDatabase()
				return db
					.prepare<[url: string], { id: number }>(`
						SELECT id FROM feeds WHERE url = ?
					`)
					.get(discoveredUrl)
			})

			if (existingDiscoveredFeed) {
				await step.run("mark-pending-completed-discovered", () => {
					const db = getDatabase()
					db.prepare(`DELETE FROM pending_feeds WHERE id = ?`).run(pendingId)
					db.prepare(`
						INSERT OR IGNORE INTO subscriptions (user_id, feed_id) VALUES (?, ?)
					`).run(requestedBy, existingDiscoveredFeed.id)
				})

				await step.run("notify-feed-exists-discovered", async () => {
					await getSSEManager().notifyUser(requestedBy, "feed.added", {
						feedId: existingDiscoveredFeed.id,
						feedUrl: discoveredUrl,
						pendingId
					})
				})

				return { feedId: existingDiscoveredFeed.id, alreadyExisted: true }
			}

			const feedId = await step.run("create-discovered-feed", () => {
				const db = getDatabase()
				db
					.prepare(`INSERT OR IGNORE INTO feeds (url) VALUES (?)`)
					.run(discoveredUrl)


				const result = db.prepare<[url: string], { id: number }>(`SELECT id FROM feeds WHERE url = ?`).get(discoveredUrl)
				if (!result) throw new Error("Failed to create discovered feed")
				const feedId = result.id

				db.prepare(`DELETE FROM pending_feeds WHERE id = ?`).run(pendingId)
				db.prepare(`
					INSERT OR IGNORE INTO subscriptions (user_id, feed_id) VALUES (?, ?)
				`).run(requestedBy, feedId)

				return feedId
			})

			await step.run("notify-discovered-feed-created", async () => {
				await getSSEManager().notifyUser(requestedBy, "feed.added", {
					feedId,
					feedUrl: discoveredUrl,
					pendingId
				})
			})

			await step.sendEvent("trigger-discovered-feed-parse", {
				name: "feed/parse.requested",
				data: { feedId }
			})

			return { feedId, created: true, discovered: true }
		}

		// Multiple feeds found, let user choose
		await step.run("mark-ambiguous", () => {
			const db = getDatabase()
			db.prepare(`
				UPDATE pending_feeds
				SET status = 'ambiguous', candidate_urls = ?
				WHERE id = ?
			`).run(JSON.stringify(validatedFeeds), pendingId)
		})

		await step.run("notify-ambiguous", async () => {
			await getSSEManager().notifyUser(requestedBy, "feed.add.ambiguous", {
				candidateUrls: validatedFeeds,
				originalUrl: feedUrl,
				pendingId
			})
		})

		return { ambiguous: true, candidateUrls: validatedFeeds }
	}
)
