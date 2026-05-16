# No-Go Triggers

> This document is a validation/evidence artifact only. It does not authorize launch, does not define a production runbook, does not perform deployment, and does not replace Final CTO approval.

Any trigger below is a no-go for Workstream 8 validation closure until resolved and re-evidenced.

1. Prisma generate fails.
2. Build fails.
3. Any Workstream 1-8 regression suite fails.
4. Health readiness does not return 503 when DB is down.
5. Health/support response leaks secrets, tokens, hashes, URLs, or stack traces.
6. Duplicate payment initiation creates duplicate PaymentIntent rows.
7. Duplicate webhook causes duplicate payment terminal transition.
8. Provider callback without verification marks payment VERIFIED.
9. Payment failure or timeout issues a ticket.
10. Duplicate verified payment issues duplicate tickets.
11. Admission replay is accepted.
12. Admission accepted without audit.
13. Admin/support read returns sensitive fields.
14. Admin/support read returns data when audit insert fails.
15. Unauthorized user accesses an admin/support route.
16. Any test requires live provider credentials.
17. Any reliability test calls a live provider endpoint.
18. Any new product scope appears during WS8.
19. A new migration is added.
20. `prisma/schema.prisma` is changed.
21. Business service files are changed without separate CTO-approved defect-patch review.
22. Existing `test:e2e` behavior is altered.
23. The stable evidence entrypoint adds launch, runbook, or product-scope content instead of evidence links only.
24. Required pilot-readiness docs are missing.
25. Required docs lack the validation-only disclaimer.
26. Required docs are not linked from the stable evidence entrypoint.
27. The evidence packet lacks a changed-file list.
28. The evidence packet lacks no-schema, no-migration, or no-business-change confirmation.
29. A concurrency test relies on sleeps or timing assumptions instead of final durable state assertions.
30. A test helper replaces the existing test harness or changes app bootstrap globally.