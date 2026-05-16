# Pilot Scope And Launch Controls

## Current State

Environment-driven launch controls now exist in the backend for the live pilot surfaces.

Current controls:

- `PILOT_CHECKOUT_ENABLED`
- `PILOT_PAYMENTS_ENABLED`
- `PILOT_ADMISSIONS_ENABLED`
- `PILOT_ALLOWED_PAYMENT_PROVIDERS`
- `PILOT_ALLOWED_CURRENCIES`
- `PILOT_ALLOWED_ORGANIZER_IDS`
- `PILOT_ALLOWED_EVENT_IDS`
- `PILOT_ALLOWED_GATE_IDS`

That closes the previous code gap. The remaining launch risk is configuration discipline: the target environment must actually set these values to the intended pilot cohort.

## Recommended Initial Scope

Initial pilot scope should be limited to:

- Paystack only.
- GHS only.
- A small named organizer cohort.
- A small named event cohort.
- Staffed gates only.
- QR admissions through `POST /api/admissions/scan` only.

Out of scope for initial pilot:

- MoMo.
- Multi-currency launch.
- Multi-country launch.
- Unstaffed or self-service gates.
- Offline mode as the primary gate operating model.

## Mandatory Launch Controls

Set and verify at least the following controls before pilot:

1. Payment provider allowlist.
   Reject payment initiation for providers outside the approved pilot list.
2. Currency allowlist.
   Reject order or payment flows outside the approved pilot currency.
3. Organizer or event allowlist.
   Only approved organizer IDs or event IDs should be allowed into the pilot.
4. Gate allowlist.
   Only named pilot gates should be allowed to validate admissions in the pilot ring.
5. Kill switch.
   Operations must be able to disable payment initiation and gate validation independently.

## Acceptable Implementation Options

The current implementation is environment-driven allowlists loaded at startup.

Other acceptable options for future evolution are:

- Environment-driven allowlists loaded at startup.
- Database-backed launch controls with admin management.
- A formal external feature-flag service.

What is not acceptable:

- Relying only on frontend behavior.
- Relying only on undocumented operational discipline.
- Treating missing credentials as a feature flag.

The last point matters because current config validation requires both Paystack and MoMo credentials at startup.

## Rollout Sequence

1. Internal staging with full observability enabled.
2. One organizer and one event in the pilot ring.
3. One venue rehearsal with real gate operators.
4. Limited live pilot window.
5. Review error budget, latency, payment reconciliation, and operator feedback before expanding scope.

## Expansion Criteria

Do not expand beyond the initial scope until:

1. No unresolved dead-letter outbox events remain from pilot traffic.
2. Payment reconciliation issues are operationally manageable.
3. Admission latency and rejection behavior remain stable during venue load.
4. MoMo has pilot-grade reliability and webhook test coverage if MoMo expansion is desired.
5. Feature controls are proven through at least one scoped rollout and one scoped rollback.
