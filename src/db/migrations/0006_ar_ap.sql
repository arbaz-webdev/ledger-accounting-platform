-- Phase 3: Accounts Receivable (invoicing) & Accounts Payable (bills)
-- Spec sections 4.2 (account mapping engine), 6 (invoicing), 7 (bills), 16.4.
--
-- Nothing here writes to the ledger. Invoices/bills/settlements call the single
-- JE posting service, which is still the only path into journal_entry_lines.

------------------------------------------------------------------------------
-- Account mapping engine (spec 4.2 / 16.4: never hard-code account numbers)
------------------------------------------------------------------------------
CREATE TABLE account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  module text NOT NULL,          -- 'invoice' | 'bill' | 'banking'
  key text NOT NULL,             -- e.g. 'ar_control', 'sales_tax_payable'
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, module, key)
);
CREATE INDEX idx_mappings_entity ON account_mappings(entity_id);

------------------------------------------------------------------------------
-- Contacts: customers and suppliers
------------------------------------------------------------------------------
CREATE TYPE contact_type AS ENUM ('customer', 'supplier');

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type contact_type NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  address text,
  payment_terms_days int NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contacts_entity_type ON contacts(entity_id, type);

------------------------------------------------------------------------------
-- Per-entity document numbering (INV-0001, BILL-0001, …)
------------------------------------------------------------------------------
CREATE TABLE document_counters (
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  next_number bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (entity_id, doc_type)
);

CREATE FUNCTION next_document_number(p_entity_id uuid, p_doc_type text) RETURNS bigint AS $$
DECLARE
  v_number bigint;
BEGIN
  INSERT INTO document_counters (entity_id, doc_type) VALUES (p_entity_id, p_doc_type)
  ON CONFLICT (entity_id, doc_type) DO NOTHING;

  UPDATE document_counters
  SET next_number = next_number + 1
  WHERE entity_id = p_entity_id AND doc_type = p_doc_type
  RETURNING next_number - 1 INTO v_number;

  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

------------------------------------------------------------------------------
-- Invoices (Accounts Receivable) — spec 6
------------------------------------------------------------------------------
CREATE TYPE document_status AS ENUM ('draft', 'posted', 'paid', 'void');

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES contacts(id),
  invoice_number text NOT NULL,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  status document_status NOT NULL DEFAULT 'draft',
  notes text,
  subtotal numeric(18, 2) NOT NULL DEFAULT 0,
  tax_total numeric(18, 2) NOT NULL DEFAULT 0,
  total numeric(18, 2) NOT NULL DEFAULT 0,
  je_id uuid REFERENCES journal_entries(id),      -- set on post (spec 16.1)
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE (entity_id, invoice_number)
);
CREATE INDEX idx_invoices_entity_status ON invoices(entity_id, status);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  description text NOT NULL,
  quantity numeric(18, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(18, 4) NOT NULL DEFAULT 0,
  revenue_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  tax_rate numeric(9, 4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  net_amount numeric(18, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(18, 2) NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, line_no)
);

------------------------------------------------------------------------------
-- Bills (Accounts Payable) — spec 7
------------------------------------------------------------------------------
CREATE TABLE bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES contacts(id),
  bill_number text NOT NULL,
  supplier_reference text,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  status document_status NOT NULL DEFAULT 'draft',
  notes text,
  subtotal numeric(18, 2) NOT NULL DEFAULT 0,
  tax_total numeric(18, 2) NOT NULL DEFAULT 0,
  total numeric(18, 2) NOT NULL DEFAULT 0,
  je_id uuid REFERENCES journal_entries(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE (entity_id, bill_number)
);
CREATE INDEX idx_bills_entity_status ON bills(entity_id, status);
CREATE INDEX idx_bills_supplier ON bills(supplier_id);

CREATE TABLE bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  description text NOT NULL,
  quantity numeric(18, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(18, 4) NOT NULL DEFAULT 0,
  expense_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  tax_rate numeric(9, 4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  net_amount numeric(18, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(18, 2) NOT NULL DEFAULT 0,
  UNIQUE (bill_id, line_no)
);

------------------------------------------------------------------------------
-- Settlements: anything that reduces an open invoice/bill balance.
-- payment      — cash received / paid          (DR Bank / CR AR, or DR AP / CR Bank)
-- credit_note  — customer or supplier credit   (DR Revenue / CR AR, or DR AP / CR Expense)
-- write_off    — bad debt                      (DR Bad Debt Expense / CR AR)
------------------------------------------------------------------------------
CREATE TYPE settlement_kind AS ENUM ('payment', 'credit_note', 'write_off');

CREATE TABLE settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind settlement_kind NOT NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE,
  bill_id uuid REFERENCES bills(id) ON DELETE CASCADE,
  date date NOT NULL,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  bank_account_id uuid REFERENCES chart_of_accounts(id),  -- payments only
  reference text,
  je_id uuid REFERENCES journal_entries(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- exactly one of invoice_id / bill_id
  CONSTRAINT settlement_one_document CHECK (num_nonnulls(invoice_id, bill_id) = 1),
  -- payments must name a bank account; credit notes / write-offs must not
  CONSTRAINT settlement_bank_account CHECK (
    (kind = 'payment' AND bank_account_id IS NOT NULL)
    OR (kind <> 'payment' AND bank_account_id IS NULL)
  )
);
CREATE INDEX idx_settlements_invoice ON settlements(invoice_id);
CREATE INDEX idx_settlements_bill ON settlements(bill_id);
CREATE INDEX idx_settlements_entity_date ON settlements(entity_id, date);

------------------------------------------------------------------------------
-- Protect posted documents: once a document carries a journal entry it is part
-- of the ledger and may not be deleted (mirrors JE immutability, spec 16.2 #4).
------------------------------------------------------------------------------
CREATE FUNCTION protect_posted_document() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'A % document cannot be deleted; only drafts may be discarded', OLD.status
      USING ERRCODE = 'P0407';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_protect_posted
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION protect_posted_document();

CREATE TRIGGER trg_bills_protect_posted
  BEFORE DELETE ON bills
  FOR EACH ROW EXECUTE FUNCTION protect_posted_document();

-- A settlement that has hit the ledger is immutable too
CREATE FUNCTION protect_posted_settlement() RETURNS trigger AS $$
BEGIN
  IF OLD.je_id IS NOT NULL THEN
    RAISE EXCEPTION 'Settlement % is posted to the ledger and is immutable', OLD.id
      USING ERRCODE = 'P0407';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_settlements_protect
  BEFORE UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION protect_posted_settlement();
