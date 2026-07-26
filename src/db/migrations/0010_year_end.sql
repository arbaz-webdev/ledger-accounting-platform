-- Phase 7: Year-end close
-- One row per fiscal-year close. The close posts a REAL closing journal entry
-- (zeroing every P&L account into Retained Earnings, dated the last day of the
-- fiscal year) — reopening voids that JE and marks the row, keeping a full
-- audit history of every close/reopen cycle.

CREATE TABLE fiscal_year_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  label text NOT NULL,                       -- e.g. 'FY2026'
  start_date date NOT NULL,
  end_date date NOT NULL,
  net_profit numeric(18, 2) NOT NULL,
  je_id uuid REFERENCES journal_entries(id), -- null when there was nothing to close
  closed_by uuid NOT NULL REFERENCES users(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  reopened_at timestamptz,
  reopened_by uuid REFERENCES users(id),
  CHECK (end_date > start_date)
);

-- Only one ACTIVE (not reopened) close per fiscal year; reclosing after a
-- reopen creates a new row, preserving history.
CREATE UNIQUE INDEX uq_fy_close_active
  ON fiscal_year_closes(entity_id, start_date) WHERE reopened_at IS NULL;
CREATE INDEX idx_fy_closes_entity ON fiscal_year_closes(entity_id, start_date);

-- History is permanent: rows may never be deleted, and the only permitted
-- update is stamping the reopen fields exactly once.
CREATE FUNCTION protect_fy_closes() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Fiscal-year close records cannot be deleted'
      USING ERRCODE = 'P0407';
  END IF;
  IF NEW.entity_id  IS DISTINCT FROM OLD.entity_id
  OR NEW.label      IS DISTINCT FROM OLD.label
  OR NEW.start_date IS DISTINCT FROM OLD.start_date
  OR NEW.end_date   IS DISTINCT FROM OLD.end_date
  OR NEW.net_profit IS DISTINCT FROM OLD.net_profit
  OR NEW.je_id      IS DISTINCT FROM OLD.je_id
  OR NEW.closed_by  IS DISTINCT FROM OLD.closed_by
  OR NEW.closed_at  IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'Only the reopen fields of a fiscal-year close may change'
      USING ERRCODE = 'P0407';
  END IF;
  IF OLD.reopened_at IS NOT NULL THEN
    RAISE EXCEPTION 'This fiscal-year close was already reopened'
      USING ERRCODE = 'P0407';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fy_closes_protect
  BEFORE UPDATE OR DELETE ON fiscal_year_closes
  FOR EACH ROW EXECUTE FUNCTION protect_fy_closes();
