-- Accounting periods with lock enforcement (spec sections 14, 16.2 rule 2)

CREATE TABLE periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id),
  year int NOT NULL,
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  is_locked boolean NOT NULL DEFAULT false,
  locked_by uuid REFERENCES users(id),
  locked_at timestamptz,
  UNIQUE (entity_id, year, month)
);

CREATE INDEX idx_periods_entity ON periods(entity_id, year, month);

-- Helper used by journal triggers: raises if the date falls in a locked period.
-- A missing period row counts as OPEN (periods are created lazily / by year setup).
CREATE FUNCTION assert_period_open(p_entity_id uuid, p_date date) RETURNS void AS $$
DECLARE
  v_locked boolean;
BEGIN
  SELECT is_locked INTO v_locked
  FROM periods
  WHERE entity_id = p_entity_id
    AND year = EXTRACT(YEAR FROM p_date)::int
    AND month = EXTRACT(MONTH FROM p_date)::int;

  IF COALESCE(v_locked, false) THEN
    RAISE EXCEPTION 'Period %-% is locked for this entity; posting rejected',
      EXTRACT(YEAR FROM p_date)::int, EXTRACT(MONTH FROM p_date)::int
      USING ERRCODE = 'P0401';
  END IF;
END;
$$ LANGUAGE plpgsql;
