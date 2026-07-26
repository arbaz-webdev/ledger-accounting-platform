-- Phase 4: Bank statement import (CSV) & reconciliation — spec section 5.
--
-- Imported rows are STAGED in bank_transactions first (spec 16.3); only when the
-- user confirms does the JE engine get called. Nothing here writes to the ledger.

------------------------------------------------------------------------------
-- Categorisation rules (spec 5.1 "Auto-Categorise")
------------------------------------------------------------------------------
CREATE TYPE rule_match AS ENUM ('contains', 'starts_with', 'equals');
CREATE TYPE rule_direction AS ENUM ('any', 'money_in', 'money_out');

CREATE TABLE bank_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  priority int NOT NULL DEFAULT 100,
  match_type rule_match NOT NULL DEFAULT 'contains',
  match_text text NOT NULL CHECK (length(trim(match_text)) > 0),
  direction rule_direction NOT NULL DEFAULT 'any',
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  times_applied int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bank_rules_entity ON bank_rules(entity_id, priority);

------------------------------------------------------------------------------
-- Reconciliations (spec 5.3) — locked once approved
------------------------------------------------------------------------------
CREATE TABLE bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  statement_date date NOT NULL,
  statement_balance numeric(18, 2) NOT NULL,
  book_balance numeric(18, 2) NOT NULL,
  cleared_total numeric(18, 2) NOT NULL DEFAULT 0,
  is_locked boolean NOT NULL DEFAULT true,
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_recon_entity_account ON bank_reconciliations(entity_id, bank_account_id, statement_date);

------------------------------------------------------------------------------
-- Import batches & column-mapping templates
------------------------------------------------------------------------------
CREATE TABLE bank_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  filename text NOT NULL,
  row_count int NOT NULL DEFAULT 0,
  imported_count int NOT NULL DEFAULT 0,
  duplicate_count int NOT NULL DEFAULT 0,
  rejected_count int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_batches_entity ON bank_import_batches(entity_id, created_at);

-- Reusable per-bank column mappings (spec 5.1 "configurable templates")
CREATE TABLE bank_import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  date_column text NOT NULL,
  description_column text NOT NULL,
  amount_column text,          -- single signed column …
  debit_column text,           -- … or separate money-out
  credit_column text,          -- … and money-in columns
  balance_column text,
  date_format text NOT NULL DEFAULT 'auto',  -- auto | dmy | mdy | ymd
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, name)
);

------------------------------------------------------------------------------
-- Staged bank transactions (spec 16.1: Unmatched / Matched / Posted)
-- amount is SIGNED from the account holder's perspective:
--   positive = money into the bank, negative = money out.
------------------------------------------------------------------------------
CREATE TYPE bank_txn_status AS ENUM ('pending', 'categorised', 'posted', 'ignored');

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES bank_import_batches(id) ON DELETE SET NULL,
  bank_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  txn_date date NOT NULL,
  description text NOT NULL,
  amount numeric(18, 2) NOT NULL CHECK (amount <> 0),
  statement_balance numeric(18, 2),
  status bank_txn_status NOT NULL DEFAULT 'pending',
  category_account_id uuid REFERENCES chart_of_accounts(id),
  matched_rule_id uuid REFERENCES bank_rules(id) ON DELETE SET NULL,
  -- exact-match fingerprint: date + amount + normalised description
  dedupe_hash text NOT NULL,
  -- near-duplicate (same amount within ±3 days) flagged for review, spec 5.1
  possible_duplicate boolean NOT NULL DEFAULT false,
  je_id uuid REFERENCES journal_entries(id),
  reconciliation_id uuid REFERENCES bank_reconciliations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bank_txn_entity_status ON bank_transactions(entity_id, status);
CREATE INDEX idx_bank_txn_account_date ON bank_transactions(bank_account_id, txn_date);
CREATE UNIQUE INDEX idx_bank_txn_dedupe ON bank_transactions(entity_id, dedupe_hash);

-- Posted rows are part of the ledger: they may not be deleted, and their
-- category/amount may not change (mirrors JE immutability, spec 16.2 #4).
CREATE FUNCTION protect_posted_bank_txn() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'Posted bank transaction % cannot be deleted; void its journal entry instead', OLD.id
        USING ERRCODE = 'P0408';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' THEN
    IF NEW.amount <> OLD.amount
       OR NEW.txn_date <> OLD.txn_date
       OR NEW.category_account_id IS DISTINCT FROM OLD.category_account_id
       OR NEW.je_id IS DISTINCT FROM OLD.je_id THEN
      RAISE EXCEPTION 'Posted bank transaction % is immutable', OLD.id USING ERRCODE = 'P0408';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bank_txn_protect
  BEFORE UPDATE OR DELETE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION protect_posted_bank_txn();

-- A locked reconciliation cannot be altered (spec 5.3)
CREATE FUNCTION protect_locked_reconciliation() RETURNS trigger AS $$
BEGIN
  IF OLD.is_locked THEN
    RAISE EXCEPTION 'Reconciliation % is locked and cannot be altered or deleted', OLD.id
      USING ERRCODE = 'P0409';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recon_protect
  BEFORE UPDATE OR DELETE ON bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION protect_locked_reconciliation();
