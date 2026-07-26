-- Phase 6: Inventory
-- Item master, cost layers (lots), stock movements. Costing method is chosen
-- PER ITEM: FIFO, AVCO (weighted average), or specific identification.
--
-- Invariants:
--   * The inventory subledger value (SUM of open lots' cost_remaining) always
--     equals what inventory movements have posted to the GL, because every
--     movement's total_cost hits the ledger in the same transaction that
--     adjusts the lots.
--   * Negative stock is blocked: qty_remaining >= 0 is a hard CHECK, and the
--     service refuses issues that exceed on-hand quantity.
--   * Movements are append-only (like the ledger): corrections are new
--     movements, never edits.

CREATE TYPE costing_method AS ENUM ('fifo', 'avco', 'specific');

CREATE TYPE inventory_movement_kind AS ENUM (
  'receipt',      -- goods in: bill posting or manual receipt      DR Inventory
  'issue',        -- goods out: invoice posting or manual issue    CR Inventory
  'adjust_in',    -- count adjustment up                           DR Inventory
  'adjust_out',   -- count adjustment down                         CR Inventory
  'write_down'    -- damage/obsolescence                           CR Inventory
);

------------------------------------------------------------------------------
-- Item master
------------------------------------------------------------------------------
CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  description text,
  costing_method costing_method NOT NULL DEFAULT 'fifo',
  unit text NOT NULL DEFAULT 'unit',
  sales_price numeric(18, 4) NOT NULL DEFAULT 0 CHECK (sales_price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, sku)
);
CREATE INDEX idx_inventory_items_entity ON inventory_items(entity_id, is_active);

------------------------------------------------------------------------------
-- Movements (append-only) and cost layers
------------------------------------------------------------------------------
CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id),
  kind inventory_movement_kind NOT NULL,
  date date NOT NULL,
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  total_cost numeric(18, 2) NOT NULL CHECK (total_cost >= 0),
  je_id uuid NOT NULL REFERENCES journal_entries(id),
  invoice_id uuid REFERENCES invoices(id),
  bill_id uuid REFERENCES bills(id),
  reference text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_movements_item ON inventory_movements(item_id, date);
CREATE INDEX idx_inventory_movements_entity ON inventory_movements(entity_id, date);

-- Cost layers. One lot per receipt/adjust_in. cost_remaining is the exact
-- value still on the books for this lot; SUM(cost_remaining) over open lots is
-- the item's subledger value and always ties to the GL inventory account.
CREATE TABLE inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id),
  lot_ref text,                             -- label for specific-ID picking
  received_date date NOT NULL,
  qty_received numeric(18, 4) NOT NULL CHECK (qty_received > 0),
  qty_remaining numeric(18, 4) NOT NULL CHECK (qty_remaining >= 0),
  unit_cost numeric(18, 6) NOT NULL CHECK (unit_cost >= 0),
  cost_remaining numeric(18, 2) NOT NULL CHECK (cost_remaining >= 0),
  source_movement_id uuid NOT NULL REFERENCES inventory_movements(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lot_qty_within_received CHECK (qty_remaining <= qty_received)
);
CREATE INDEX idx_inventory_lots_item_open
  ON inventory_lots(item_id, received_date) WHERE qty_remaining > 0;

-- Which lots an outbound movement consumed (audit trail for FIFO/specific).
CREATE TABLE inventory_movement_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id uuid NOT NULL REFERENCES inventory_movements(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES inventory_lots(id),
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  cost numeric(18, 2) NOT NULL CHECK (cost >= 0)
);
CREATE INDEX idx_movement_lots_movement ON inventory_movement_lots(movement_id);
CREATE INDEX idx_movement_lots_lot ON inventory_movement_lots(lot_id);

------------------------------------------------------------------------------
-- Immutability triggers
------------------------------------------------------------------------------
-- Movements: append-only. Corrections are new movements.
CREATE FUNCTION protect_inventory_movements() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movements are append-only; record a correcting movement instead'
    USING ERRCODE = 'P0407';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_movements_protect
  BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION protect_inventory_movements();

-- Lots: only the remaining-quantity/value columns may change, and never below
-- zero (CHECKs above). Everything else about a layer is history.
CREATE FUNCTION protect_inventory_lots() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Inventory lots cannot be deleted' USING ERRCODE = 'P0407';
  END IF;
  IF NEW.item_id      IS DISTINCT FROM OLD.item_id
  OR NEW.entity_id    IS DISTINCT FROM OLD.entity_id
  OR NEW.lot_ref      IS DISTINCT FROM OLD.lot_ref
  OR NEW.received_date IS DISTINCT FROM OLD.received_date
  OR NEW.qty_received IS DISTINCT FROM OLD.qty_received
  OR NEW.unit_cost    IS DISTINCT FROM OLD.unit_cost
  OR NEW.source_movement_id IS DISTINCT FROM OLD.source_movement_id THEN
    RAISE EXCEPTION 'Only remaining quantity/value of an inventory lot may change'
      USING ERRCODE = 'P0407';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_lots_protect
  BEFORE UPDATE OR DELETE ON inventory_lots
  FOR EACH ROW EXECUTE FUNCTION protect_inventory_lots();

CREATE TRIGGER trg_inventory_movement_lots_protect
  BEFORE UPDATE OR DELETE ON inventory_movement_lots
  FOR EACH ROW EXECUTE FUNCTION protect_inventory_movements();

------------------------------------------------------------------------------
-- Document integration: invoice/bill lines may reference an item
------------------------------------------------------------------------------
ALTER TABLE invoice_lines ADD COLUMN item_id uuid REFERENCES inventory_items(id);
ALTER TABLE bill_lines ADD COLUMN item_id uuid REFERENCES inventory_items(id);
