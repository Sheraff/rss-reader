import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join } from 'path'

let db: Database.Database | null = null

/**
 * Get or create the SQLite database instance
 */
export function getDatabase(): Database.Database {
	if (db) {
		return db
	}

	// Create database file in project root
	const dbPath = join(process.cwd(), 'rss-reader.db')
	db = new Database(dbPath)

	// Enable foreign keys
	db.pragma('foreign_keys = ON')

	// WAL mode for better concurrency
	db.pragma('journal_mode = WAL')

	return db
}

/**
 * Initialize the database with the schema
 */
export function initializeDatabase(): void {
	const database = getDatabase()

	// Read and execute schema
	const schemaPath = join(__dirname, 'schema.sql')
	const schema = readFileSync(schemaPath, 'utf-8')

	// Execute all statements in the schema
	database.exec(schema)

	console.log('Database initialized successfully')
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
	if (db) {
		db.close()
		db = null
	}
}

// Export the database getter as default
export default getDatabase
