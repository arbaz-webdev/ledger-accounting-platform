-- Phase 9: SaaS tiers — platform owner, subscribing firms, plans
--
-- The product has four tiers of user, each with its own portal:
--   1. platform_admin  /platform   the software vendor (you)
--   2. firm_owner      /firm       the accounting firm that buys a subscription
--   3. firm_admin,
--      accountant_staff /accountant staff who keep the books
--   4. business_*,
--      view_only        /business   the firm's clients, read-only
--
-- Tenancy was already firm-scoped (users.firm_id, entities.firm_id); this
-- migration adds the commercial layer on top: what a firm is entitled to.

------------------------------------------------------------------------------
-- The firm subscriber role. Added first and NOT used in this migration —
-- Postgres forbids using a new enum value in the transaction that adds it.
------------------------------------------------------------------------------
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'firm_owner';

------------------------------------------------------------------------------
-- Plans: what a subscription entitles a firm to.
-- NULL limit = unlimited (a plain integer can't express "no cap").
------------------------------------------------------------------------------
CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  monthly_price numeric(18, 2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  max_entities int CHECK (max_entities IS NULL OR max_entities > 0),
  max_users int CHECK (max_users IS NULL OR max_users > 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

------------------------------------------------------------------------------
-- Firms gain subscriber metadata and a kill switch
------------------------------------------------------------------------------
ALTER TABLE firms ADD COLUMN legal_name text;
ALTER TABLE firms ADD COLUMN contact_email text;
ALTER TABLE firms ADD COLUMN contact_phone text;
ALTER TABLE firms ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- Clients can be archived without deleting their ledger
ALTER TABLE entities ADD COLUMN is_active boolean NOT NULL DEFAULT true;

------------------------------------------------------------------------------
-- Subscriptions
--   trial      → full access, time-boxed
--   active     → paying
--   past_due   → still allowed in, warned (grace period)
--   suspended  → locked out of every portal except platform
--   cancelled  → historical; a firm may re-subscribe (new row)
------------------------------------------------------------------------------
CREATE TYPE subscription_status AS ENUM (
  'trial', 'active', 'past_due', 'suspended', 'cancelled'
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id),
  status subscription_status NOT NULL DEFAULT 'trial',
  started_on date NOT NULL DEFAULT CURRENT_DATE,
  trial_ends_on date,
  current_period_end date,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A firm has at most ONE live subscription; cancelled rows stay as history.
CREATE UNIQUE INDEX uq_subscription_live
  ON subscriptions(firm_id) WHERE status <> 'cancelled';
CREATE INDEX idx_subscriptions_firm ON subscriptions(firm_id);

------------------------------------------------------------------------------
-- Default plan catalogue
------------------------------------------------------------------------------
INSERT INTO plans (code, name, description, monthly_price, max_entities, max_users, sort_order)
VALUES
  ('trial',        'Trial',        'Time-boxed evaluation of the full platform.',        0.00,    2,    3, 10),
  ('starter',      'Starter',      'Small practice: a handful of clients.',             49.00,    5,    5, 20),
  ('professional', 'Professional', 'Growing practice with a bookkeeping team.',        149.00,   25,   20, 30),
  ('enterprise',   'Enterprise',   'Unlimited clients and staff.',                     399.00, NULL, NULL, 40);

------------------------------------------------------------------------------
-- Backfill: every firm that already exists keeps working. Without this, the
-- subscription gate would lock existing firms out on the next request.
------------------------------------------------------------------------------
INSERT INTO subscriptions (firm_id, plan_id, status, started_on, current_period_end, notes)
SELECT f.id,
       (SELECT id FROM plans WHERE code = 'professional'),
       'active',
       CURRENT_DATE,
       CURRENT_DATE + INTERVAL '1 year',
       'Backfilled when subscriptions were introduced.'
FROM firms f
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.firm_id = f.id);
