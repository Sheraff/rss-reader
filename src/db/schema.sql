-- RSS Reader Database Schema
-- SQLite database schema for multi-user RSS feed reader

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT NOT NULL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Feeds table
-- Each feed represents a unique RSS/Atom feed URL
CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'rss' CHECK (type IN ('rss', 'atom')),
  
  -- Feed metadata (RSS/Atom common fields)
  title TEXT,
  description TEXT,
  link TEXT,
  language TEXT,
  
  -- Authorship
  author_name TEXT,
  author_email TEXT,
  author_uri TEXT,
  
  -- Visual elements
  image_url TEXT,
  image_title TEXT,
  icon_url TEXT,
  logo_url TEXT,
  
  -- Rights & attribution
  copyright TEXT,
  generator TEXT,
  generator_version TEXT,
  generator_uri TEXT,
  
  -- Feed management
  last_build_date TIMESTAMP,
  ttl INTEGER, -- Time to live in minutes
  
  -- HTTP caching headers for efficient fetching
  etag TEXT,
  last_modified_header TEXT,
  
  -- Operational fields
  last_fetched_at TIMESTAMP,
  last_success_at TIMESTAMP,
  fetch_error_count INTEGER NOT NULL DEFAULT 0,
  fetch_error_message TEXT,
  is_active BOOLEAN NOT NULL DEFAULT 1,
  
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Articles table
-- Each article represents an item/entry from a feed
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL,
  
  -- Identity (GUID for deduplication)
  guid TEXT NOT NULL,
  guid_is_permalink BOOLEAN DEFAULT 0,
  url TEXT,
  
  -- Content
  title TEXT NOT NULL,
  content TEXT, -- Full content (HTML from RSS or extracted via Readability)
  summary TEXT, -- Excerpt/summary (from RSS or Readability)
  content_type TEXT DEFAULT 'html' CHECK (content_type IN ('text', 'html', 'xhtml')),
  
  -- Authorship
  author_name TEXT, -- Author name (from RSS or Readability byline)
  author_email TEXT,
  author_uri TEXT,
  
  -- Dates
  published_at TIMESTAMP, -- Publication date (from RSS or Readability publishedTime)
  updated_at TIMESTAMP,
  
  -- Categories/tags (stored as JSON array)
  categories TEXT, -- JSON: [{term, scheme, label}]
  
  -- Media/enclosures
  enclosure_url TEXT,
  enclosure_type TEXT,
  enclosure_length INTEGER,
  
  -- Metadata
  comments_url TEXT,
  rights TEXT,
  source_title TEXT, -- Site/publication name (from RSS or Readability siteName)
  source_url TEXT,
  
  -- Fetch status tracking
  fetch_status TEXT NOT NULL DEFAULT 'none' CHECK (fetch_status IN ('none', 'scheduled', 'complete', 'failed')),
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scraped_at TIMESTAMP,
  
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
  UNIQUE(feed_id, guid)
);

-- Subscriptions table
-- Connects users to feeds they subscribe to
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  feed_id INTEGER NOT NULL,
  category TEXT, -- Optional user-defined category (free-form string)
  
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
  UNIQUE(user_id, feed_id)
);

-- User-Article junction table
-- Tracks read status, bookmarks, and favorites per user per article
CREATE TABLE IF NOT EXISTS user_article (
  user_id TEXT NOT NULL,
  article_id INTEGER NOT NULL,
  
  -- User interaction flags
  is_read BOOLEAN NOT NULL DEFAULT 0,
  is_bookmarked BOOLEAN NOT NULL DEFAULT 0,
  is_favorited BOOLEAN NOT NULL DEFAULT 0,
  
  -- Timestamps
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (user_id, article_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- Indexes for performance

-- Subscriptions indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_feed_id ON subscriptions(feed_id);

-- Articles indexes
CREATE INDEX IF NOT EXISTS idx_articles_feed_id_published ON articles(feed_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_guid ON articles(guid);
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);

-- User-Article indexes
CREATE INDEX IF NOT EXISTS idx_user_article_user_id ON user_article(user_id);
CREATE INDEX IF NOT EXISTS idx_user_article_article_id ON user_article(article_id);

-- Feeds indexes
CREATE INDEX IF NOT EXISTS idx_feeds_last_fetched ON feeds(last_fetched_at);
CREATE INDEX IF NOT EXISTS idx_feeds_is_active ON feeds(is_active);

-- Triggers for automatic updated_at timestamps

CREATE TRIGGER IF NOT EXISTS update_users_timestamp
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS update_feeds_timestamp
AFTER UPDATE ON feeds
FOR EACH ROW
BEGIN
  UPDATE feeds SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS update_subscriptions_timestamp
AFTER UPDATE ON subscriptions
FOR EACH ROW
BEGIN
  UPDATE subscriptions SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS update_user_article_timestamp
AFTER UPDATE ON user_article
FOR EACH ROW
BEGIN
  UPDATE user_article SET updated_at = CURRENT_TIMESTAMP 
  WHERE user_id = OLD.user_id AND article_id = OLD.article_id;
END;

-- Pending feeds table
-- Tracks async feed validation/creation requests
CREATE TABLE IF NOT EXISTS pending_feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'ambiguous')),
  result_feed_id INTEGER,
  candidate_urls JSON, -- JSON array of discovered feed URLs
  error_message TEXT,
  
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (result_feed_id) REFERENCES feeds(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_feeds_user_id ON pending_feeds(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_feeds_status ON pending_feeds(status);

CREATE TRIGGER IF NOT EXISTS update_pending_feeds_timestamp
AFTER UPDATE ON pending_feeds
FOR EACH ROW
BEGIN
  UPDATE pending_feeds SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
