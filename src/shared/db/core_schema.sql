-- Historical reference only. The executable schema source of truth is
-- prisma/schema.prisma plus prisma/migrations/.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE order_status AS ENUM (
  'CREATED',
  'RESERVED',
  'PAYMENT_PENDING',
  'PAID',
  'FULFILLED',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'FAILED'
);

CREATE TYPE payment_status AS ENUM (
  'INITIATED',
  'PENDING',
  'SUCCESS',
  'FAILED',
  'REVERSED',
  'REFUNDED'
);

CREATE TYPE ticket_status AS ENUM (
  'ISSUED',
  'ACTIVE',
  'USED',
  'EXITED',
  'INVALIDATED',
  'REFUNDED',
  'BLOCKED'
);

CREATE TYPE admission_state AS ENUM (
  'NOT_USED',
  'INSIDE',
  'EXITED',
  'REJECTED',
  'BLOCKED'
);

CREATE TYPE booking_state AS ENUM (
  'AVAILABLE',
  'HELD',
  'RESERVED',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TYPE scan_direction AS ENUM (
  'ENTRY',
  'EXIT'
);

CREATE TYPE admission_event_result AS ENUM (
  'ACCEPTED',
  'REJECTED',
  'CONFLICT_DUPLICATE_OFFLINE_ENTRY',
  'CONFLICT_EXIT_WITHOUT_ENTRY',
  'CONFLICT_ALREADY_CONSUMED_ONLINE',
  'BLOCKED'
);

CREATE TYPE ledger_direction AS ENUM (
  'DEBIT',
  'CREDIT'
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE venues (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE events (
  id UUID PRIMARY KEY,
  organizer_id UUID NOT NULL,
  name TEXT NOT NULL,
  venue_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  capacity_total INT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_events_organizer
    FOREIGN KEY (organizer_id) REFERENCES users(id),
  CONSTRAINT fk_events_venue
    FOREIGN KEY (venue_id) REFERENCES venues(id),
  CHECK (capacity_total > 0),
  CHECK (starts_at < ends_at)
);

CREATE TABLE ticket_types (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ticket_types_event
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT uq_ticket_types_event_name
    UNIQUE(event_id, name),
  CONSTRAINT uq_ticket_types_id_event
    UNIQUE(id, event_id)
);

CREATE TABLE event_ticket_inventory (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL,
  ticket_type_id UUID NOT NULL,
  capacity_total INT NOT NULL,
  reserved_count INT NOT NULL DEFAULT 0,
  sold_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_inventory_event
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_ticket_type
    FOREIGN KEY (ticket_type_id, event_id)
      REFERENCES ticket_types(id, event_id) ON DELETE CASCADE,
  CONSTRAINT uq_event_ticket_inventory
    UNIQUE(event_id, ticket_type_id),
  CHECK (capacity_total >= 0),
  CHECK (reserved_count >= 0),
  CHECK (sold_count >= 0),
  CHECK (reserved_count + sold_count <= capacity_total)
);

CREATE VIEW event_ticket_inventory_availability AS
SELECT
  id,
  event_id,
  ticket_type_id,
  capacity_total,
  reserved_count,
  sold_count,
  GREATEST(capacity_total - reserved_count - sold_count, 0) AS available,
  updated_at
FROM event_ticket_inventory;

CREATE TABLE reservations (
  id UUID PRIMARY KEY,
  order_id UUID,
  event_id UUID NOT NULL,
  user_id UUID,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_reservations_event
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_reservations_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (expires_at >= created_at)
);

CREATE TABLE ticket_reservations (
  id UUID PRIMARY KEY,
  reservation_id UUID NOT NULL,
  event_id UUID NOT NULL,
  ticket_type_id UUID NOT NULL,
  quantity INT NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ticket_reservations_reservation
    FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  CONSTRAINT fk_reservation_event
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_reservations_ticket_type
    FOREIGN KEY (ticket_type_id, event_id)
      REFERENCES ticket_types(id, event_id),
  CONSTRAINT uq_ticket_reservation_line
    UNIQUE(reservation_id, ticket_type_id),
  CONSTRAINT chk_reservation_status
    CHECK (status IN ('HELD', 'EXPIRED', 'CONSUMED', 'CANCELLED')),
  CHECK (quantity > 0),
  CHECK (expires_at >= created_at)
);

CREATE OR REPLACE FUNCTION live_reserved_quantity(
  p_event_id UUID,
  p_ticket_type_id UUID
) RETURNS INT
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(SUM(quantity), 0)::INT
  FROM ticket_reservations
  WHERE event_id = p_event_id
    AND ticket_type_id = p_ticket_type_id
    AND status = 'HELD'
    AND expires_at > NOW();
$$;

CREATE OR REPLACE FUNCTION inventory_is_tight(
  p_capacity_total INT,
  p_available INT
) RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT p_available <= GREATEST(CEIL(p_capacity_total * 0.05)::INT, 50);
$$;

CREATE OR REPLACE FUNCTION inventory_drift_exceeded(
  p_capacity_total INT,
  p_cached_reserved INT,
  p_live_reserved INT
) RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT ABS(p_cached_reserved - p_live_reserved) > GREATEST(CEIL(p_capacity_total * 0.02)::INT, 20);
$$;

CREATE TABLE orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  event_id UUID NOT NULL,
  reservation_id UUID NOT NULL,
  status order_status NOT NULL,
  total_amount BIGINT NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_orders_event
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_user
    FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_orders_reservation
    FOREIGN KEY (reservation_id) REFERENCES ticket_reservations(id),
  CONSTRAINT chk_orders_status
    CHECK (status::TEXT IN ('CREATED', 'RESERVED', 'PAYMENT_PENDING', 'PAID', 'FULFILLED', 'COMPLETED', 'EXPIRED', 'FAILED', 'CANCELLED')),
  CHECK (total_amount >= 0),
  CHECK (char_length(currency) BETWEEN 3 AND 8)
);

ALTER TABLE reservations
  ADD CONSTRAINT reservations_order_fk
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

CREATE TABLE payments (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  payment_attempt_sequence INT NOT NULL DEFAULT 1,
  status payment_status NOT NULL,
  amount BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_payments_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT chk_payments_status
    CHECK (status::TEXT IN ('INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'REVERSED', 'REFUNDED')),
  UNIQUE(order_id, provider, payment_attempt_sequence),
  CHECK (payment_attempt_sequence > 0),
  CHECK (amount >= 0)
);

CREATE UNIQUE INDEX uq_payments_provider_ref
ON payments(provider, provider_ref)
WHERE provider_ref IS NOT NULL;

CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY,
  order_id UUID,
  payment_id UUID,
  direction ledger_direction NOT NULL,
  account_type TEXT NOT NULL,
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ledger_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_ledger_payment
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL,
  CHECK (amount >= 0),
  CHECK (char_length(currency) BETWEEN 3 AND 8)
);

CREATE TABLE tickets (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL,
  event_id UUID NOT NULL,
  ticket_type_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  ticket_serial TEXT NOT NULL,
  public_reference TEXT NOT NULL,
  status ticket_status NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_tickets_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_event
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_tickets_ticket_type
    FOREIGN KEY (ticket_type_id, event_id)
      REFERENCES ticket_types(id, event_id),
  CONSTRAINT chk_tickets_status
    CHECK (status::TEXT IN ('ISSUED', 'ACTIVE', 'USED', 'EXITED', 'INVALIDATED', 'REFUNDED', 'BLOCKED'))
);

CREATE TABLE ticket_admission_state (
  ticket_id UUID PRIMARY KEY,
  current_state admission_state NOT NULL DEFAULT 'NOT_USED',
  admission_cycle_no INT NOT NULL DEFAULT 0,
  last_entry_at TIMESTAMPTZ,
  last_exit_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_admission_ticket
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT chk_admission_state
    CHECK (current_state::TEXT IN ('NOT_USED', 'INSIDE', 'EXITED', 'REJECTED', 'BLOCKED')),
  CHECK (admission_cycle_no >= 0),
  CHECK (version >= 0)
);

COMMENT ON TABLE ticket_admission_state IS
  'Phase 3 enforcement: every update must predicate on the current version and increment it atomically; if zero rows are affected, retry or reject.';

COMMENT ON COLUMN ticket_admission_state.version IS
  'Optimistic concurrency counter for stale update prevention and race-safe state transitions.';

CREATE TABLE gates (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_gates_venue
    FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
  CONSTRAINT uq_gates_venue_label
    UNIQUE(venue_id, label)
);

CREATE TABLE admission_events (
  id UUID PRIMARY KEY,
  scan_event_id UUID,
  ticket_id UUID NOT NULL,
  admission_cycle_no INT NOT NULL DEFAULT 0,
  direction scan_direction NOT NULL,
  result admission_event_result NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL,
  gate_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_admission_events_ticket
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_admission_events_gate
    FOREIGN KEY (gate_id) REFERENCES gates(id) ON DELETE SET NULL,
  CHECK (admission_cycle_no >= 0)
);

CREATE UNIQUE INDEX uq_admission_events_scan_event_id
ON admission_events(scan_event_id)
WHERE scan_event_id IS NOT NULL;

CREATE UNIQUE INDEX uq_admission_events_cycle_direction_accepted
ON admission_events(ticket_id, admission_cycle_no, direction)
WHERE result = 'ACCEPTED';

CREATE TABLE user_devices (
  id UUID PRIMARY KEY,
  user_id UUID,
  device_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user_devices_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_user_device_fingerprint
    UNIQUE(user_id, device_fingerprint)
);

CREATE TABLE suspicious_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  ticket_id UUID,
  device_id UUID,
  severity TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_suspicious_ticket
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
  CONSTRAINT fk_suspicious_device
    FOREIGN KEY (device_id) REFERENCES user_devices(id) ON DELETE SET NULL
);

CREATE TABLE offline_scan_events (
  scan_event_id UUID PRIMARY KEY,
  ticket_id UUID,
  device_id UUID,
  direction scan_direction,
  local_timestamp TIMESTAMPTZ,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reconciliation_status TEXT,
  CONSTRAINT fk_offline_scan_ticket
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
  CONSTRAINT fk_offline_scan_device
    FOREIGN KEY (device_id) REFERENCES user_devices(id) ON DELETE SET NULL
);

CREATE TABLE idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  actor_id UUID,
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_code INT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_idempotency_actor
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE ticket_risk_flags (
  id UUID PRIMARY KEY,
  ticket_id UUID NOT NULL,
  risk_type TEXT NOT NULL,
  risk_score INT,
  flagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ticket_risk_ticket
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100)
);

CREATE TABLE device_risk_flags (
  id UUID PRIMARY KEY,
  device_id UUID NOT NULL,
  risk_type TEXT NOT NULL,
  risk_score INT,
  flagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_device_risk_device
    FOREIGN KEY (device_id) REFERENCES user_devices(id) ON DELETE CASCADE,
  CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100)
);

CREATE TABLE qr_nonce_usage (
  nonce TEXT PRIMARY KEY,
  ticket_id UUID NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_qr_nonce_ticket
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

CREATE TABLE venue_tables (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL,
  label TEXT NOT NULL,
  capacity INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_venue_tables_venue
    FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
  CONSTRAINT uq_venue_tables_label
    UNIQUE(venue_id, label),
  CHECK (capacity > 0)
);

CREATE TABLE table_bookings (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES venue_tables(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  booking_state booking_state NOT NULL,
  booking_time_range TSTZRANGE NOT NULL,
  party_size INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (party_size > 0),
  CHECK (NOT ISEMPTY(booking_time_range))
);

ALTER TABLE table_bookings
  ADD CONSTRAINT table_bookings_no_overlap
  EXCLUDE USING gist (
    table_id WITH =,
    booking_time_range WITH &&
  )
  WHERE (booking_state IN ('RESERVED', 'CONFIRMED'));

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  actor_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_audit_actor
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_reservation_event_type
ON ticket_reservations(event_id, ticket_type_id);

CREATE INDEX idx_reservation_expiry
ON ticket_reservations(expires_at)
WHERE status = 'HELD';

CREATE INDEX idx_active_reservations
ON ticket_reservations(event_id, ticket_type_id, expires_at)
WHERE status = 'HELD';

CREATE INDEX idx_orders_user_event_created
ON orders(user_id, event_id, created_at DESC);

CREATE INDEX idx_payments_order
ON payments(order_id);

CREATE INDEX idx_payments_status
ON payments(status);

CREATE INDEX idx_tickets_event
ON tickets(event_id);

CREATE INDEX idx_tickets_owner
ON tickets(owner_user_id);

CREATE UNIQUE INDEX uq_ticket_serial
ON tickets(ticket_serial);

CREATE UNIQUE INDEX uq_ticket_public_ref
ON tickets(public_reference);

CREATE INDEX idx_admission_state_status
ON ticket_admission_state(current_state);

CREATE INDEX idx_admission_ticket
ON admission_events(ticket_id);

CREATE INDEX idx_admission_event_time
ON admission_events(ticket_id, scanned_at DESC);

CREATE INDEX idx_offline_ticket
ON offline_scan_events(ticket_id);

CREATE INDEX idx_offline_reconcile_status
ON offline_scan_events(reconciliation_status);

CREATE INDEX idx_risk_ticket
ON ticket_risk_flags(ticket_id);

CREATE INDEX idx_risk_device
ON device_risk_flags(device_id);

CREATE INDEX idx_qr_nonce_usage_ticket_used_at
ON qr_nonce_usage(ticket_id, used_at DESC);

CREATE INDEX idx_table_bookings_event_state
ON table_bookings(event_id, booking_state);

CREATE INDEX idx_outbox_events_unprocessed
ON outbox_events(created_at)
WHERE processed = FALSE;

CREATE INDEX idx_audit_logs_entity_created
ON audit_logs(entity_type, entity_id, created_at DESC);