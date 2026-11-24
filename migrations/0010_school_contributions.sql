-- Voluntary, non-fee contributions from school administrators to Navstar.
CREATE TABLE IF NOT EXISTS school_contributions (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
 amount REAL NOT NULL CHECK(amount >= 10 AND amount <= 5000),
 phone_number TEXT NOT NULL,
 checkout_request_id TEXT NOT NULL UNIQUE,
 merchant_request_id TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','failed')),
 mpesa_receipt_number TEXT,
 transaction_date TEXT,
 result_code INTEGER,
 result_description TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_school_contributions_school ON school_contributions(school_id,created_at);
