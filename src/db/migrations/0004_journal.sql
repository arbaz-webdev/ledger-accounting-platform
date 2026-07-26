-- Journal & Ledger engine (spec sections 4, 8, 16.2)
-- The rules here are enforced at the DATABASE level per spec 16.2:
--   1. Debits = Credits per journal entry (deferred constraint trigger)
--   2. Period lock checked before any line insert
--   3. Posted entries are immutable (void-by-reversal only)

CREATE TYPE je_status AS ENUM ('draft', 'pending_approval', 'posted', 'voided');

CREATE TYPE source_module AS ENUM (
  'manual', 'invoice', 'bill', 'payroll', 'bank', 'inventory', 'system'
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id),
  je_number bigint,                      -- assigned at posting time, sequential per entity
  date date NOT NULL,
  reference text,
  description text NOT NULL,
  source_module source_module NOT NULL DEFAULT 'manual',
  status je_status NOT NULL DEFAULT 'draft',
  voided_by_je_id uuid REFERENCES journal_entries(id),  -- set on the ORIGINAL when voided
  reverses_je_id uuid REFERENCES journal_entries(id),   -- set on the REVERSAL entry
  auto_reverse_on date,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid REFERENCES users(id),
  posted_at timestamptz,
  UNIQUE (entity_id, je_number),
  CONSTRAINT je_posted_fields CHECK (
    status NOT IN ('posted', 'voided')
    OR (je_number IS NOT NULL AND posted_by IS NOT NULL AND posted_at IS NOT NULL)
  )
);

CREATE INDEX idx_je_entity_date ON journal_entries(entity_id, date);
CREATE INDEX idx_je_entity_status ON journal_entries(entity_id, status);

CREATE TABLE journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  je_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  description text,
  -- transaction currency amounts
  currency char(3) NOT NULL,
  fx_rate numeric(18, 8) NOT NULL DEFAULT 1,
  debit numeric(18, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(18, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  -- base currency amounts (spec 16.2 rule 6: reports run in base currency)
  debit_base numeric(18, 2) NOT NULL DEFAULT 0 CHECK (debit_base >= 0),
  credit_base numeric(18, 2) NOT NULL DEFAULT 0 CHECK (credit_base >= 0),
  CONSTRAINT line_single_side CHECK (NOT (debit > 0 AND credit > 0)),
  CONSTRAINT line_nonzero CHECK (debit > 0 OR credit > 0),
  UNIQUE (je_id, line_no)
);

CREATE INDEX idx_je_lines_je ON journal_entry_lines(je_id);
CREATE INDEX idx_je_lines_account ON journal_entry_lines(account_id);

-- Per-entity JE number allocation. Row-level lock serialises concurrent posts
-- (spec 16.2 rule 10: no duplicate JE numbers under concurrency).
CREATE TABLE je_counters (
  entity_id uuid PRIMARY KEY REFERENCES entities(id),
  next_number bigint NOT NULL DEFAULT 1
);

CREATE FUNCTION next_je_number(p_entity_id uuid) RETURNS bigint AS $$
DECLARE
  v_number bigint;
BEGIN
  INSERT INTO je_counters (entity_id) VALUES (p_entity_id)
  ON CONFLICT (entity_id) DO NOTHING;

  UPDATE je_counters
  SET next_number = next_number + 1
  WHERE entity_id = p_entity_id
  RETURNING next_number - 1 INTO v_number;

  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

------------------------------------------------------------------------------
-- RULE 1: SUM(debit_base) = SUM(credit_base) per JE, checked at COMMIT.
-- Deferred so multi-line inserts within one transaction validate as a set.
------------------------------------------------------------------------------
CREATE FUNCTION je_check_balanced() RETURNS trigger AS $$
DECLARE
  v_je_id uuid;
  v_debits numeric(18, 2);
  v_credits numeric(18, 2);
  v_line_count int;
BEGIN
  v_je_id := COALESCE(NEW.je_id, OLD.je_id);

  -- JE may have been deleted in the same transaction (draft discard) — nothing to check
  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = v_je_id) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit_base), 0), COALESCE(SUM(credit_base), 0), COUNT(*)
  INTO v_debits, v_credits, v_line_count
  FROM journal_entry_lines
  WHERE je_id = v_je_id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Journal entry % must have at least 2 lines (one debit, one credit)', v_je_id
      USING ERRCODE = 'P0402';
  END IF;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: debits % <> credits %',
      v_je_id, v_debits, v_credits
      USING ERRCODE = 'P0403';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_je_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION je_check_balanced();

------------------------------------------------------------------------------
-- RULE 2: Period lock — reject postings dated in a locked period.
-- Checked on the JE header (insert / date change / status change)
-- and on every line insert (spec: "Before any INSERT to journal_entry_lines").
------------------------------------------------------------------------------
CREATE FUNCTION je_check_period() RETURNS trigger AS $$
BEGIN
  PERFORM assert_period_open(NEW.entity_id, NEW.date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_period
  BEFORE INSERT OR UPDATE OF date, status ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_check_period();

CREATE FUNCTION je_line_check_period() RETURNS trigger AS $$
DECLARE
  v_entity uuid;
  v_date date;
BEGIN
  SELECT entity_id, date INTO v_entity, v_date
  FROM journal_entries WHERE id = NEW.je_id;
  PERFORM assert_period_open(v_entity, v_date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_line_period
  BEFORE INSERT ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION je_line_check_period();

------------------------------------------------------------------------------
-- RULE 3: Immutability of posted entries (spec 16.2 rules 4 & 5).
-- Posted JEs: only permitted change is status -> voided (+ voided_by_je_id).
-- Posted/voided JE lines can never be updated or deleted.
------------------------------------------------------------------------------
CREATE FUNCTION je_protect_posted() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'voided') THEN
      RAISE EXCEPTION 'Posted journal entry % cannot be deleted; void it instead', OLD.id
        USING ERRCODE = 'P0404';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'Voided journal entry % is immutable', OLD.id USING ERRCODE = 'P0404';
  END IF;

  IF OLD.status = 'posted' THEN
    IF NEW.status = 'voided'
       AND NEW.entity_id = OLD.entity_id
       AND NEW.je_number = OLD.je_number
       AND NEW.date = OLD.date
       AND NEW.description = OLD.description
       AND NEW.source_module = OLD.source_module
       AND COALESCE(NEW.reference, '') = COALESCE(OLD.reference, '')
       AND NEW.posted_by = OLD.posted_by
       AND NEW.posted_at = OLD.posted_at THEN
      RETURN NEW;  -- void transition only
    END IF;
    RAISE EXCEPTION 'Posted journal entry % is immutable; only void-by-reversal is allowed', OLD.id
      USING ERRCODE = 'P0404';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_protect_posted
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_protect_posted();

CREATE FUNCTION je_line_protect_posted() RETURNS trigger AS $$
DECLARE
  v_status je_status;
BEGIN
  SELECT status INTO v_status FROM journal_entries
  WHERE id = COALESCE(OLD.je_id, NEW.je_id);

  -- v_status is NULL when the parent JE row was already deleted (cascade) — allow
  IF v_status IN ('posted', 'voided') THEN
    RAISE EXCEPTION 'Lines of a posted journal entry are immutable' USING ERRCODE = 'P0404';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_line_protect_posted
  BEFORE UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION je_line_protect_posted();

------------------------------------------------------------------------------
-- Account validation (spec 16.2 rule 3): line account must belong to the same
-- entity as the JE and be active at posting time.
------------------------------------------------------------------------------
CREATE FUNCTION je_line_check_account() RETURNS trigger AS $$
DECLARE
  v_entity uuid;
  v_acct_entity uuid;
  v_active boolean;
BEGIN
  SELECT entity_id INTO v_entity FROM journal_entries WHERE id = NEW.je_id;
  SELECT entity_id, is_active INTO v_acct_entity, v_active
  FROM chart_of_accounts WHERE id = NEW.account_id;

  IF v_acct_entity IS NULL OR v_acct_entity <> v_entity THEN
    RAISE EXCEPTION 'Account % does not belong to this entity', NEW.account_id
      USING ERRCODE = 'P0405';
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'Account % is inactive and cannot receive postings', NEW.account_id
      USING ERRCODE = 'P0405';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_line_check_account
  BEFORE INSERT ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION je_line_check_account();
