/**
 * Database table type definitions
 */

export type FeedType = "rss" | "atom"
export type ContentType = "text" | "html" | "xhtml"
export type FetchStatus = "none" | "scheduled" | "complete" | "failed"

export interface User {
	id: string
	created_at: string
	updated_at: string
}

export interface Feed {
	id: number
	url: string
	slug: string
	type: FeedType

	// Feed metadata
	title: string | null
	description: string | null
	link: string | null
	language: string | null

	// Authorship
	author_name: string | null
	author_email: string | null
	author_uri: string | null

	// Visual elements
	image_url: string | null
	image_title: string | null
	icon_url: string | null
	logo_url: string | null

	// Rights & attribution
	copyright: string | null
	generator: string | null
	generator_version: string | null
	generator_uri: string | null

	// Feed management
	last_build_date: string | null
	ttl: number | null

	// HTTP caching
	etag: string | null
	last_modified_header: string | null

	// Operational
	last_fetched_at: string | null
	last_success_at: string | null
	fetch_error_count: number
	fetch_error_message: string | null
	is_active: boolean

	created_at: string
	updated_at: string
}

export interface Article {
	id: number
	feed_id: number

	// Identity
	guid: string
	guid_is_permalink: boolean
	url: string | null

	// Content
	title: string
	content: string | null
	summary: string | null
	content_type: ContentType

	// Authorship
	author_name: string | null
	author_email: string | null
	author_uri: string | null

	// Dates
	published_at: string | null
	updated_at: string | null

	// Categories (JSON array)
	categories: string | null

	// Media/enclosures
	enclosure_url: string | null
	enclosure_type: string | null
	enclosure_length: number | null

	// Metadata
	comments_url: string | null
	rights: string | null
	source_title: string | null
	source_url: string | null

	// Fetch status
	fetch_status: FetchStatus

	// Timestamps
	created_at: string
	scraped_at: string | null
}

export interface Subscription {
	id: number
	user_id: number
	feed_id: number
	category: string | null
	created_at: string
	updated_at: string
}

export interface UserArticle {
	user_id: number
	article_id: number
	is_read: boolean
	is_bookmarked: boolean
	is_favorited: boolean
	read_at: string | null
	created_at: string
	updated_at: string
}

/**
 * Joined query types
 */

export interface FeedWithSubscription {
	id: number
	url: string
	slug: string
	title: string | null
	description: string | null
	image_url: string | null
	icon_url: string | null
	link: string | null
	last_fetched_at: string | null
	last_success_at: string | null
	category: string | null
	subscribed_at: string
	unread_count: number
}

/**
 * Insert types (without auto-generated fields)
 */

export interface UserInsert {
	id?: number
}

export interface FeedInsert {
	url: string
	slug: string
	type?: FeedType
	title?: string | null
	description?: string | null
	link?: string | null
	language?: string | null
	author_name?: string | null
	author_email?: string | null
	author_uri?: string | null
	image_url?: string | null
	image_title?: string | null
	icon_url?: string | null
	logo_url?: string | null
	copyright?: string | null
	generator?: string | null
	generator_version?: string | null
	generator_uri?: string | null
	last_build_date?: string | null
	ttl?: number | null
	etag?: string | null
	last_modified_header?: string | null
	last_fetched_at?: string | null
	last_success_at?: string | null
	fetch_error_count?: number
	fetch_error_message?: string | null
	is_active?: boolean
}

export interface ArticleInsert {
	feed_id: number
	guid: string
	guid_is_permalink?: boolean
	url?: string | null
	title: string
	content?: string | null
	summary?: string | null
	content_type?: ContentType
	author_name?: string | null
	author_email?: string | null
	author_uri?: string | null
	published_at?: string | null
	updated_at?: string | null
	categories?: string | null
	enclosure_url?: string | null
	enclosure_type?: string | null
	enclosure_length?: number | null
	comments_url?: string | null
	rights?: string | null
	source_title?: string | null
	source_url?: string | null
	fetch_status?: FetchStatus
	scraped_at?: string | null
}

export interface SubscriptionInsert {
	user_id: number
	feed_id: number
	category?: string | null
}

export interface UserArticleInsert {
	user_id: number
	article_id: number
	is_read?: boolean
	is_bookmarked?: boolean
	is_favorited?: boolean
	read_at?: string | null
}

/**
 * Update types (all fields optional except identifiers)
 */

export interface FeedUpdate {
	url?: string
	slug?: string
	type?: FeedType
	title?: string | null
	description?: string | null
	link?: string | null
	language?: string | null
	author_name?: string | null
	author_email?: string | null
	author_uri?: string | null
	image_url?: string | null
	image_title?: string | null
	icon_url?: string | null
	logo_url?: string | null
	copyright?: string | null
	generator?: string | null
	generator_version?: string | null
	generator_uri?: string | null
	last_build_date?: string | null
	ttl?: number | null
	etag?: string | null
	last_modified_header?: string | null
	last_fetched_at?: string | null
	last_success_at?: string | null
	fetch_error_count?: number
	fetch_error_message?: string | null
	is_active?: boolean
}

export interface ArticleUpdate {
	feed_id?: number
	guid?: string
	guid_is_permalink?: boolean
	url?: string | null
	title?: string
	content?: string | null
	summary?: string | null
	content_type?: ContentType
	author_name?: string | null
	author_email?: string | null
	author_uri?: string | null
	published_at?: string | null
	updated_at?: string | null
	categories?: string | null
	enclosure_url?: string | null
	enclosure_type?: string | null
	enclosure_length?: number | null
	comments_url?: string | null
	rights?: string | null
	source_title?: string | null
	source_url?: string | null
	fetch_status?: FetchStatus
	scraped_at?: string | null
}

export interface SubscriptionUpdate {
	category?: string | null
}

export interface UserArticleUpdate {
	is_read?: boolean
	is_bookmarked?: boolean
	is_favorited?: boolean
	read_at?: string | null
}

/**
 * Category type for articles (JSON structure)
 */
export interface ArticleCategory {
	term: string
	scheme?: string
	label?: string
}
