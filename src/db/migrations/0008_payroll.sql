-- Phase 5: Payroll
-- Employees, pay runs, payslip lines. Statutory deductions/contributions are
-- accountant-entered rates or fixed amounts per employee (no built-in tax
-- slab engine — tax law changes yearly and belongs to the accountant, not
-- the app). Mirrors the AR/AP pattern: nothing here writes to the ledger
-- directly, pay runs call the single JE posting service.

------------------------------------------------------------------------------
-- Employees
------------------------------------------------------------------------------
CREATE TYPE payroll_frequency AS ENUM ('monthly', 'biweekly', 'weekly');

CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  employee_number text NOT NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  hire_date date NOT NULL,
  termination_date date,
  is_active boolean NOT NULL DEFAULT true,
  pay_frequency payroll_frequency NOT NULL DEFAULT 'monthly',
  -- Recurring per-pay-period figures. All accountant-entered; the app never
  -- computes a statutory tax table.
  basic_salary numeric(18, 2) NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
  allowances numeric(18, 2) NOT NULL DEFAULT 0 CHECK (allowances >= 0),
  income_tax_rate numeric(9, 4) NOT NULL DEFAULT 0 CHECK (income_tax_rate >= 0),      -- % of gross
  eobi_employee_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (eobi_employee_amount >= 0),
  eobi_employer_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (eobi_employer_amount >= 0),
  payroll_tax_employer_rate numeric(9, 4) NOT NULL DEFAULT 0 CHECK (payroll_tax_employer_rate >= 0), -- % of gross
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, employee_number)
);
CREATE INDEX idx_employees_entity_active ON employees(entity_id, is_active);

------------------------------------------------------------------------------
-- Pay runs (one per pay period) and their per-employee lines
------------------------------------------------------------------------------
CREATE TYPE pay_run_status AS ENUM ('draft', 'posted', 'paid');

CREATE TABLE pay_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  run_number text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  pay_date date NOT NULL,
  status pay_run_status NOT NULL DEFAULT 'draft',
  gross_total numeric(18, 2) NOT NULL DEFAULT 0,
  income_tax_total numeric(18, 2) NOT NULL DEFAULT 0,
  eobi_employee_total numeric(18, 2) NOT NULL DEFAULT 0,
  eobi_employer_total numeric(18, 2) NOT NULL DEFAULT 0,
  payroll_tax_employer_total numeric(18, 2) NOT NULL DEFAULT 0,
  net_total numeric(18, 2) NOT NULL DEFAULT 0,
  je_id uuid REFERENCES journal_entries(id),          -- posting JE (expense + liabilities)
  payment_je_id uuid REFERENCES journal_entries(id),  -- payment JE (liability -> bank)
  bank_account_id uuid REFERENCES chart_of_accounts(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  paid_at timestamptz,
  UNIQUE (entity_id, run_number)
);
CREATE INDEX idx_pay_runs_entity_status ON pay_runs(entity_id, status);

CREATE TABLE pay_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_run_id uuid NOT NULL REFERENCES pay_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  basic_salary numeric(18, 2) NOT NULL DEFAULT 0,
  allowances numeric(18, 2) NOT NULL DEFAULT 0,
  gross_pay numeric(18, 2) NOT NULL DEFAULT 0,
  income_tax_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (income_tax_amount >= 0),
  eobi_employee_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (eobi_employee_amount >= 0),
  eobi_employer_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (eobi_employer_amount >= 0),
  payroll_tax_employer_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (payroll_tax_employer_amount >= 0),
  net_pay numeric(18, 2) NOT NULL DEFAULT 0 CHECK (net_pay >= 0),
  UNIQUE (pay_run_id, employee_id)
);

------------------------------------------------------------------------------
-- Immutability: a pay run leaves 'draft' the moment it is posted. Reuses
-- protect_posted_document() (spec/16.2 pattern) — it only checks OLD.status.
------------------------------------------------------------------------------
CREATE TRIGGER trg_pay_runs_protect_posted
  BEFORE DELETE ON pay_runs
  FOR EACH ROW EXECUTE FUNCTION protect_posted_document();

CREATE FUNCTION protect_posted_payrun_lines() RETURNS trigger AS $$
DECLARE
  v_status pay_run_status;
BEGIN
  SELECT status INTO v_status FROM pay_runs WHERE id = COALESCE(NEW.pay_run_id, OLD.pay_run_id);
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'Pay run lines cannot be changed once the run is %', v_status
      USING ERRCODE = 'P0407';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pay_run_lines_protect
  BEFORE UPDATE OR DELETE ON pay_run_lines
  FOR EACH ROW EXECUTE FUNCTION protect_posted_payrun_lines();
