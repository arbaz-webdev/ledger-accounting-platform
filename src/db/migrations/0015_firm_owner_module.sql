-- Firm profile and tenant-safe team grouping.
ALTER TABLE firms ADD COLUMN fax text;
ALTER TABLE firms ADD COLUMN contact_person text;
ALTER TABLE firms ADD COLUMN logo_data bytea;
ALTER TABLE firms ADD COLUMN logo_mime text;

-- The practice's own books live in a dedicated entity, outside client limits.
ALTER TABLE entities ADD COLUMN is_firm_books boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX uq_firm_books_per_firm ON entities(firm_id) WHERE is_firm_books;

CREATE TABLE firm_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, id)
);
CREATE UNIQUE INDEX uq_firm_team_name ON firm_teams(firm_id, lower(name));

-- Composite foreign keys prevent cross-firm team assignments even if a
-- service bug presents a valid user ID from another firm.
CREATE UNIQUE INDEX uq_users_firm_id ON users(firm_id, id);
CREATE TABLE firm_team_members (
  firm_id uuid NOT NULL,
  team_id uuid NOT NULL,
  user_id uuid PRIMARY KEY,
  added_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (firm_id, team_id) REFERENCES firm_teams(firm_id, id) ON DELETE CASCADE,
  FOREIGN KEY (firm_id, user_id) REFERENCES users(firm_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_firm_team_members_team ON firm_team_members(team_id);

-- Optional firm tracking of client billing arrangements. Amounts are
-- contract data; they do not create invoices or ledger revenue.
CREATE TABLE client_subscription_management (
  entity_id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  managed_by text NOT NULL DEFAULT 'client' CHECK (managed_by IN ('firm','client')),
  monthly_fee numeric(18,2) NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  renewal_on date,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
