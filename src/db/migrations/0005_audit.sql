-- Append-only audit trail (spec section 15.2)

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id uuid REFERENCES entities(id),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,             -- e.g. JE_POSTED, JE_VOIDED, COA_UPDATED, PERIOD_LOCKED, LOGIN
  table_name text,
  record_id text,
  before_state jsonb,
  after_state jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity_date ON audit_log(entity_id, created_at);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at);

-- Append-only: no UPDATE or DELETE, ever — even for admins (spec 15.2).
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'P0406';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
