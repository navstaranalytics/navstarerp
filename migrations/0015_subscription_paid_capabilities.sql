-- Paid capability billing for school subscriptions. Additive; preserve existing contracts and invoices.
ALTER TABLE school_subscriptions ADD COLUMN paid_modules_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE school_subscriptions ADD COLUMN module_amounts_json TEXT NOT NULL DEFAULT '{}';
