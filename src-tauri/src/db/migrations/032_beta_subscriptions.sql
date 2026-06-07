CREATE TABLE IF NOT EXISTS beta_subscriptions (
    slug          TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    code          TEXT NOT NULL,
    subscribed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
