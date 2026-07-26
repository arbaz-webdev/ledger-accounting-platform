-- Chart of Accounts (spec section 3)

CREATE TYPE account_type AS ENUM (
  'asset',          -- 1xxx  normal debit,  balance sheet
  'liability',      -- 2xxx  normal credit, balance sheet
  'equity',         -- 3xxx  normal credit, balance sheet
  'revenue',        -- 4xxx  normal credit, P&L
  'cogs',           -- 5xxx  normal debit,  P&L (below the line)
  'expense',        -- 6xxx  normal debit,  P&L
  'other_income',   -- 7xxx  normal credit, P&L
  'other_expense',  -- 8xxx  normal debit,  P&L
  'tax'             -- 9xxx  normal debit,  P&L
);

CREATE TABLE chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id),
  account_number text NOT NULL,
  name text NOT NULL,
  type account_type NOT NULL,
  sub_type text,
  parent_id uuid REFERENCES chart_of_accounts(id),
  currency char(3),                -- NULL = entity base currency
  tax_code text,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,  -- Retained Earnings, Suspense: cannot delete
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, account_number)
);

CREATE INDEX idx_coa_entity ON chart_of_accounts(entity_id);
CREATE INDEX idx_coa_parent ON chart_of_accounts(parent_id);

-- System accounts must never be deleted (spec 3: "auto-created and cannot be deleted")
CREATE FUNCTION coa_protect_system_accounts() RETURNS trigger AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'System account % (%) cannot be deleted', OLD.account_number, OLD.name;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_coa_protect_system
  BEFORE DELETE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION coa_protect_system_accounts();
