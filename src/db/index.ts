import Database from "better-sqlite3"
import { join } from "node:path"
import schema from "./schema.sql?raw"

let db: Database.Database | null = null

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

	process.addListener("beforeExit", () => {
		if (db) {
			db.close()
			db = null
		}
	})

	// Determine database path from argument, env var, or default
	const dbPath = path ?? process.env.DB_PATH ?? join(process.cwd(), "rss-reader.db")
	db = new Database(dbPath)

	// Enable foreign keys
	db.pragma("foreign_keys = ON")

	// WAL mode for better concurrency
	db.pragma("journal_mode = WAL")

	// Execute all statements in the schema
	db.exec(schema)

	return db
}
