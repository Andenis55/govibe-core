# Evidence Archival Checklist

> This document is an operator procedure template only. It does not authorize pilot launch, production deployment, live traffic, payment acceptance, admissions, refunds, payouts, or data changes. Final CTO go/no-go approval is required before any pilot execution.

When in doubt, archive identifiers and status summaries, not raw records.

## Do Not Archive

- raw customer passwords
- access tokens
- refresh/session tokens
- QR/admission tokens
- admissionTokenHash
- tokenHash
- scanNonceHash
- provider secrets
- provider credentials
- raw webhook headers
- full raw provider payloads
- unredacted personal data
- private env/config values
- stack traces containing secrets

## Payment Evidence May Include Only

- paymentIntent IDs
- provider names
- statuses
- timestamps
- amounts/currencies
- redacted provider references
- error category without raw secret payload

## Admission Evidence May Include Only

- ticket IDs
- event IDs
- scan status
- rejection reason
- gate label
- timestamps
- device label if safe

## Support / Admin Evidence May Include Only

- audit log IDs
- actor IDs
- action names
- status
- target type
- target ID
- reasonCode
- redacted metadata
- timestamps

## Archive Access Control

- Evidence archive location must be access-controlled.
- Only designated pilot operators and approval owners should access archived evidence.

## Archival Checklist

- [ ] Archive location confirmed
- [ ] Access-control owner confirmed
- [ ] IDs/status summaries used instead of raw records
- [ ] Redaction review completed
- [ ] Sensitive values excluded