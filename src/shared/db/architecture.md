# Core Domain Notes

## Inventory

Use `event_ticket_inventory` as the lock target and `ticket_reservations` as the authoritative hold ledger.

Locked inventory read:

```sql
SELECT id, capacity_total, reserved_count, sold_count
FROM event_ticket_inventory
WHERE event_id = $1
  AND ticket_type_id = $2
FOR UPDATE;
```

Cached availability:

```sql
available = capacity_total - reserved_count - sold_count
```

When inventory is tight, recompute from live holds inside the same transaction:

```sql
SELECT COALESCE(SUM(quantity), 0)
FROM ticket_reservations
WHERE event_id = $1
  AND ticket_type_id = $2
  AND status = 'HELD'
  AND expires_at > NOW();
```

Tight inventory rule:

- `available <= 5% of capacity`
- or `available <= 50`

Reconcile cached `reserved_count` when drift is greater than `2% of capacity` or `20`, whichever is larger.

Advisory locks are optional coordination helpers only. If used, keep them transaction-scoped and never use them instead of row locks on `event_ticket_inventory`.

```sql
SELECT pg_advisory_xact_lock(hashtext($1));
```

## QR Rotation

Validation flow:

1. User must hold a valid authenticated session.
2. Server computes `time_window = floor(current_unix_time / 15)`.
3. Server generates a nonce for that window.
4. Server signs `window + nonce + ticket context`.
5. Client displays the signed token.
6. Validator accepts the current window and the immediately previous window for up to `10` seconds of grace.
7. Nonce consumption must happen atomically during validation so the first accepted scan invalidates reuse.

Redis is the fast path for replay protection. The database table is the audit fallback.

Suggested Redis keys:

- `ticket_state:{ticket_id}`
- `ticket_nonce_used:{ticket_id}:{nonce}`
- `event_revoked:{event_id}`
- `qr_nonce:{event_id}:{ticket_id}:{nonce}`

Suggested nonce TTL: token expiry plus grace period.

## Admission

Use `ticket_admission_state` as the fast path and keep `admission_events` append-only.

Locked admission read:

```sql
SELECT *
FROM ticket_admission_state
WHERE ticket_id = $1
FOR UPDATE;
```

Use `version` for optimistic concurrency on state transitions:

```sql
UPDATE ticket_admission_state
SET current_state = $new_state,
    version = version + 1
WHERE ticket_id = $1
  AND version = $current_version;
```

If the update affects `0` rows, treat the write as stale and retry or reject it. Richer transitions may update additional columns such as `admission_cycle_no`, `last_entry_at`, and `last_exit_at`, but the version predicate and increment are mandatory on every state write.

The schema applies duplicate direction protection only to accepted scans per cycle, which preserves an audit trail for rejected retries without allowing duplicate accepted entry or exit transitions.

Offline scan sync is deduplicated by `offline_scan_events.scan_event_id`.

## Order Reservation Link

`orders.reservation_id` is mandatory and points to `ticket_reservations.id`.

Expected write sequence:

1. Create reservation header.
2. Create reservation line items.
3. Create order linked to the reservation line that allocated inventory.
4. Optionally attach the reservation header back to the order through `reservations.order_id`.

## Table Bookings

`table_bookings` uses a GiST exclusion constraint to block overlapping `RESERVED` and `CONFIRMED` time ranges for the same table.

## Fraud And Risk

The schema includes `suspicious_events`, `ticket_risk_flags`, and `device_risk_flags` for first-pass anomaly capture and risk scoring. These tables keep the current model intentionally small: append suspicious observations, then attach durable device or ticket flags as downstream fraud logic matures.

## Schema Scope

Modeled domain relationships are now enforced with database-level foreign keys. The remaining intentionally unconstrained references are polymorphic records such as `outbox_events.aggregate_id` and `audit_logs.entity_id`, where the owning table depends on runtime aggregate metadata instead of a single fixed relation.
