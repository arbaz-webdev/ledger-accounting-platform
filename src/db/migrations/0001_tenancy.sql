-- Tenancy: platform -> firms (accounting practices) -> entities (client businesses)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM (
  'platform_admin',
  'firm_admin',
  'accountant_staff',
  'business_admin',
  'business_staff',
  'view_only'
);

CREATE TABLE firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES firms(id),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role user_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- platform admins have no firm; everyone else must belong to one
  CONSTRAINT users_firm_required CHECK (role = 'platform_admin' OR firm_id IS NOT NULL)
);

CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  name text NOT NULL,
  legal_name text,
  base_currency char(3) NOT NULL DEFAULT 'USD',
  fiscal_year_start_month int NOT NULL DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_entities_firm ON entities(firm_id);

-- Which entities a user can access.
-- firm_admin implicitly has access to all entities of their firm;
-- accountant_staff and business users get explicit rows here.
CREATE TABLE user_entity_access (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  -- per-module grants for business users, e.g. {"invoicing": true, "bills": false}
  module_permissions jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, entity_id)
);

CREATE TABLE sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
