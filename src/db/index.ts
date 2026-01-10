import Database from 'better-sqlite3'
import { join } from 'node:path'
import schema from './schema.sql?raw'

let db: Database.Database | null = null

/**
 * Get or create the SQLite database instance
 */
export function getDatabase(): Database.Database {
	if (db) {
		return db
	}

	process.addListener('beforeExit', () => {
		if (db) {
			db.close()
			db = null
		}
	})

	// Create database file in project root
	const dbPath = join(process.cwd(), 'rss-reader.db')
	db = new Database(dbPath)

	// Enable foreign keys
	db.pragma('foreign_keys = ON')

	// WAL mode for better concurrency
	db.pragma('journal_mode = WAL')

	// Execute all statements in the schema
	db.exec(schema)

	return db
}

