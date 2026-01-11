import Database from "better-sqlite3"
import { join } from "node:path"
import schema from "./schema.sql?raw"

let db: Database.Database | null = null

const cleanup = () => {
	if (db) {
		console.log("\nClosing database connection...")
		try {
			db.close()
		} catch (err) {
			console.error("Error closing database:", err)
		}
		db = null
	}
}
process.on("SIGINT", () => {
	cleanup()
	process.exit(130)
})
process.on("SIGTERM", () => {
	cleanup()
	process.exit(0)
})

/**
 * Get or create the SQLite database instance
 * @param path - Optional database path. Supports:
 *   - Absolute file path
 *   - ':memory:' for in-memory database (useful for tests)
 *   - Defaults to DB_PATH env variable or 'rss-reader.db' in project root
 */
export function getDatabase(path?: string): Database.Database {
	if (db) {
		return db
	}

	// Determine database path from argument, env var, or default
	const dbPath = path ?? process.env.DB_PATH ?? join(process.cwd(), "rss-reader.sqlite")
	db = new Database(dbPath)

	// Enable foreign keys
	db.pragma("foreign_keys = ON")

	// WAL mode for better concurrency
	db.pragma("journal_mode = WAL")

	// Execute all statements in the schema
	db.exec(schema)

	return db
}

export { generateUniqueSlug } from "./slug"
