-- Phase 8: Hardening — multi-currency, permissions, exports
--
-- Multi-currency model: documents are DENOMINATED in a currency and carry the
-- rate used to book them. The ledger stays in base currency — `debit_base` /
-- `credit_base` were always the source of truth for every report, so nothing
-- downstream changes. A document's control-account balance is relieved at the
-- DOCUMENT's rate; settling at a different rate produces a realised FX gain or
-- loss, which is what keeps the subledger tied to the GL exactly.

------------------------------------------------------------------------------
-- FX rates: one rate per currency per date, per entity
------------------------------------------------------------------------------
CREATE TABLE fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  currency char(3) NOT NULL,
  as_of_date date NOT NULL,
  -- units of BASE currency per 1 unit of `currency`
  rate numeric(18, 8) NOT NULL CHECK (rate > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, currency, as_of_date)
);
CREATE INDEX idx_fx_rates_lookup ON fx_rates(entity_id, currency, as_of_date DESC);

------------------------------------------------------------------------------
-- Documents carry their currency + the rate they were booked at
------------------------------------------------------------------------------
ALTER TABLE invoices ADD COLUMN currency char(3);
UPDATE invoices i SET currency = e.base_currency FROM entities e WHERE e.id = i.entity_id;
ALTER TABLE invoices ALTER COLUMN currency SET NOT NULL;
ALTER TABLE invoices ADD COLUMN fx_rate numeric(18, 8) NOT NULL DEFAULT 1 CHECK (fx_rate > 0);

ALTER TABLE bills ADD COLUMN currency char(3);
UPDATE bills b SET currency = e.base_currency FROM entities e WHERE e.id = b.entity_id;
ALTER TABLE bills ALTER COLUMN currency SET NOT NULL;
ALTER TABLE bills ADD COLUMN fx_rate numeric(18, 8) NOT NULL DEFAULT 1 CHECK (fx_rate > 0);

-- Settlements are entered in the document's currency, at their own rate
ALTER TABLE settlements ADD COLUMN fx_rate numeric(18, 8) NOT NULL DEFAULT 1 CHECK (fx_rate > 0);
-- Realised FX difference posted with this settlement (base currency, signed:
-- positive = gain). Informational; the ledger is always the source of truth.
ALTER TABLE settlements ADD COLUMN fx_difference numeric(18, 2) NOT NULL DEFAULT 0;

------------------------------------------------------------------------------
-- FX gain / loss accounts for every existing entity (new entities get these
-- from DEFAULT_COA_TEMPLATE). Idempotent.
------------------------------------------------------------------------------
INSERT INTO chart_of_accounts (entity_id, account_number, name, type, sub_type, is_system)
SELECT e.id, '7200', 'Foreign Exchange Gain', 'other_income', 'fx', false FROM entities e
ON CONFLICT (entity_id, account_number) DO NOTHING;

INSERT INTO chart_of_accounts (entity_id, account_number, name, type, sub_type, is_system)
SELECT e.id, '8200', 'Foreign Exchange Loss', 'other_expense', 'fx', false FROM entities e
ON CONFLICT (entity_id, account_number) DO NOTHING;
