-- Nonfinancial invoice reference, kept separate from immutable ledger amounts.
ALTER TABLE invoices ADD COLUMN purchase_order_reference text;
ALTER TABLE inventory_items ADD COLUMN is_service boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_items ADD COLUMN reorder_level numeric(18,4) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0);

CREATE TABLE business_settings (
  entity_id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  legal_structure text,
  tax_identifiers text,
  registered_address text,
  brand_accent char(7) NOT NULL DEFAULT '#0d9488',
  invoice_header text,
  invoice_prefix text NOT NULL DEFAULT 'INV',
  bill_prefix text NOT NULL DEFAULT 'BILL',
  invoice_terms text,
  default_tax_rate numeric(9,4) NOT NULL DEFAULT 0,
  invoice_email_template text,
  reminder_email_template text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Existing business users receive the read-only inventory report by default.
UPDATE user_entity_access uea SET module_permissions = uea.module_permissions || '{"inventory":true}'::jsonb
FROM users u WHERE u.id=uea.user_id AND u.role IN ('business_admin','business_staff')
  AND NOT (uea.module_permissions ? 'inventory');
