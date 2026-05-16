# Incident Response Playbooks

> This document is an operator procedure template only. It does not authorize pilot launch, production deployment, live traffic, payment acceptance, admissions, refunds, payouts, or data changes. Final CTO go/no-go approval is required before any pilot execution.

Do not message users, organizers, providers, or public channels with unverified incident claims.

Only the designated communication owner may send external updates.

Preserve evidence before broad communication.

Do not paste secrets, raw tokens, QR/admission tokens, provider credentials, raw webhook payloads, unredacted customer data, or private environment values into chat channels, tickets, or public documents.

## Incident Communication Control

- Communication owner:
- Internal update channel placeholder:
- External update approval requirement: required
- Evidence preservation requirement: required before broad communication
- Sensitive-data handling rule: use redacted IDs/status summaries only

## Incident Severity Levels

- SEV-1: Safety, financial integrity, admission integrity, or data exposure risk
- SEV-2: Degraded payment/admission/support operation with workaround
- SEV-3: Minor operational issue with no integrity risk

## Response Playbooks

| Playbook | Minimum severity | First response | Communication owner | Evidence preservation requirement | Sensitive-data handling rule |
| --- | --- | --- | --- | --- | --- |
| Payment provider outage | SEV-2 | Pause affected payment activity and confirm current provider status | Payments Lead | preserve provider status summary, timestamps, impacted IDs | use redacted provider references and IDs only |
| Webhook verification failure | SEV-1 | pause affected verification flow and escalate | Technical Lead | preserve webhook event IDs, status summary, timestamps | do not archive raw webhook headers or payloads |
| Duplicate payment alert | SEV-1 | pause affected payment activity and escalate | Payments Lead | preserve paymentIntent IDs, status summaries, timestamps | do not share raw customer data or provider secrets |
| Ticket issuance failure | SEV-2 | pause affected issuance activity and escalate | Admissions/Gate Lead | preserve paymentIntent IDs, ticket IDs, status summary | use IDs/status summaries only |
| Duplicate ticket issuance suspicion | SEV-1 | pause affected issuance activity and escalate | Admissions/Gate Lead | preserve ticket IDs, audit IDs, timestamps | use redacted metadata only |
| Admission replay accepted | SEV-1 | pause admissions and escalate immediately | Admissions/Gate Lead | preserve ticket IDs, event IDs, scan/audit summaries | never share QR/admission tokens |
| Gate scanner unavailable | SEV-2 | pause affected gate activity and escalate | Admissions/Gate Lead | preserve device label, gate label, timestamps | use safe device labels only |
| Health readiness failure | SEV-1 | pause pilot activity and escalate | Technical Lead | preserve live/ready summaries, timestamps | do not archive secret-bearing output |
| Support/admin redaction leak | SEV-1 | pause affected support workflow and escalate | Security/Privacy Lead | preserve audit IDs, target IDs, redacted metadata | never paste leaked values into tickets or chats |
| Audit logging failure | SEV-1 | pause affected workflow and escalate | Technical Lead | preserve audit status summary, timestamps | use IDs and redacted metadata only |
| Database connectivity issue | SEV-1 | pause pilot activity and escalate | Technical Lead | preserve health evidence, timestamps, impact summary | do not include private env/config values |
| Secret exposure suspicion | SEV-1 | pause affected workflow and escalate immediately | Security/Privacy Lead | preserve exposure scope summary, timestamps, evidence references | never restate suspected secrets in communications |
