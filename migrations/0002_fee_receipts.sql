-- Fee receipts are immutable ledger entries. Triggers reconcile account balances atomically.
CREATE TABLE IF NOT EXISTS fee_receipts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  learner_fee_account_id TEXT NOT NULL REFERENCES learner_fee_accounts(id) ON DELETE RESTRICT,
  receipt_number TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash','Bank transfer','Mobile money','Cheque','Card','Other')),
  reference TEXT,
  received_at TEXT NOT NULL,
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (school_id, receipt_number)
);
CREATE INDEX IF NOT EXISTS ix_fee_receipts_account ON fee_receipts(school_id, learner_fee_account_id, received_at);
CREATE TRIGGER IF NOT EXISTS fee_receipts_validate_balance
BEFORE INSERT ON fee_receipts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM learner_fee_accounts a
    WHERE a.id=NEW.learner_fee_account_id AND a.school_id=NEW.school_id AND a.balance>=NEW.amount
  ) THEN RAISE(ABORT, 'Receipt exceeds the outstanding fee balance or account is invalid') END;
END;
CREATE TRIGGER IF NOT EXISTS fee_receipts_apply_balance
AFTER INSERT ON fee_receipts
BEGIN
  UPDATE learner_fee_accounts
  SET amount_paid=amount_paid+NEW.amount,
      balance=MAX(0,amount_due-(amount_paid+NEW.amount)),
      status=CASE WHEN amount_due-(amount_paid+NEW.amount)<=0.000001 THEN 'paid' ELSE 'part_paid' END
  WHERE id=NEW.learner_fee_account_id AND school_id=NEW.school_id;
END;
