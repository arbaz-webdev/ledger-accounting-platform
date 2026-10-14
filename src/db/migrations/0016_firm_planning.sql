-- Firm-level client allocation, time cost snapshots and monthly plans.
-- All monetary reports continue to read the firm ledger for actual revenue.
-- Existing business owners receive newly available forms unless the firm has
-- already set an explicit grant or denial for that module.
UPDATE user_entity_access access
SET module_permissions = access.module_permissions
  || CASE WHEN access.module_permissions ? 'journal' THEN '{}'::jsonb ELSE '{"journal":true}'::jsonb END
  || CASE WHEN access.module_permissions ? 'payroll' THEN '{}'::jsonb ELSE '{"payroll":true}'::jsonb END
FROM users u WHERE u.id=access.user_id AND u.role='business_admin'
  AND (NOT (access.module_permissions ? 'journal') OR NOT (access.module_permissions ? 'payroll'));
CREATE UNIQUE INDEX uq_entities_firm_id ON entities(firm_id,id);

CREATE TABLE firm_client_links (
  firm_id uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_entity_id uuid PRIMARY KEY,
  customer_contact_id uuid NOT NULL UNIQUE REFERENCES contacts(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (firm_id,client_entity_id) REFERENCES entities(firm_id,id) ON DELETE CASCADE
);

CREATE TABLE firm_staff_rates (
  firm_id uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id uuid PRIMARY KEY,
  hourly_cost numeric(18,2) NOT NULL CHECK (hourly_cost >= 0),
  capacity_hours_week numeric(6,2) NOT NULL CHECK (capacity_hours_week > 0 AND capacity_hours_week <= 168),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (firm_id,user_id) REFERENCES users(firm_id,id) ON DELETE CASCADE
);

CREATE TABLE firm_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_entity_id uuid NOT NULL,
  user_id uuid NOT NULL,
  work_date date NOT NULL,
  hours numeric(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  hourly_cost numeric(18,2) NOT NULL CHECK (hourly_cost >= 0),
  billable boolean NOT NULL DEFAULT true,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (firm_id,client_entity_id) REFERENCES entities(firm_id,id),
  FOREIGN KEY (firm_id,user_id) REFERENCES users(firm_id,id)
);
CREATE INDEX idx_firm_time_period ON firm_time_entries(firm_id,work_date);
CREATE INDEX idx_firm_time_client ON firm_time_entries(client_entity_id,work_date);

CREATE TABLE firm_budgets (
  firm_id uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  month_start date NOT NULL CHECK (EXTRACT(DAY FROM month_start)=1),
  currency char(3) NOT NULL,
  revenue_target numeric(18,2) NOT NULL CHECK (revenue_target >= 0),
  expense_budget numeric(18,2) NOT NULL CHECK (expense_budget >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firm_id,month_start)
);

-- A linked customer must be a customer contact in this firm's own books.
CREATE FUNCTION guard_firm_client_link() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM entities client WHERE client.id=NEW.client_entity_id
      AND client.firm_id=NEW.firm_id AND NOT client.is_firm_books
  ) OR NOT EXISTS (
    SELECT 1 FROM contacts c JOIN entities books ON books.id=c.entity_id
    WHERE c.id=NEW.customer_contact_id AND c.type='customer'
      AND books.firm_id=NEW.firm_id AND books.is_firm_books
  ) THEN RAISE EXCEPTION 'Firm client link must remain inside the firm and its own books' USING ERRCODE='P0410'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_firm_client_link BEFORE INSERT OR UPDATE ON firm_client_links
  FOR EACH ROW EXECUTE FUNCTION guard_firm_client_link();

CREATE FUNCTION guard_firm_time_client() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM entities e WHERE e.id=NEW.client_entity_id
    AND e.firm_id=NEW.firm_id AND NOT e.is_firm_books) THEN
    RAISE EXCEPTION 'Time must be assigned to a client in the firm' USING ERRCODE='P0410';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_firm_time_client BEFORE INSERT OR UPDATE ON firm_time_entries
  FOR EACH ROW EXECUTE FUNCTION guard_firm_time_client();
