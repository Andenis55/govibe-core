# Auth Token Security Notes

## Refresh Token Replay Detection

The session model stores a `previous_refresh_token_hash` field that holds the bcrypt hash
of the immediately preceding refresh token. This enables single-depth replay detection:

- After each successful rotation the outgoing hash is saved as `previous_refresh_token_hash`
  before being replaced by the new token's hash.
- On the next refresh attempt, if the JTI does not match the current token, the presented
  token is compared against `previous_refresh_token_hash`.
- If it matches, the token is a replay of the previous rotation. The session is immediately
  revoked (`status = REVOKED`, `revokedReason = 'refresh replay detected'`), both hash
  fields are cleared, and a `REFRESH_REPLAY_DETECTED` audit entry is written.

**Limitation — single-depth marker only.**
The previous-token marker is overwritten on every rotation. Only the immediately preceding
refresh token can be detected as a replay. A token two or more rotations old will not match
`previous_refresh_token_hash` and will be rejected as a plain JTI mismatch rather than a
replay. This is intentional: the single-depth marker is sufficient to catch the primary
threat (leaked token from the previous rotation) without requiring a token history table.

**Limitation — marker cleared on revocation.**
When a session is revoked by any path (logout, explicit revoke, replay detection), both
`refresh_token_hash` and `previous_refresh_token_hash` are cleared or null. Subsequent
refresh attempts against a revoked session are rejected by the status check before any hash
comparison occurs.

## Refresh Token Entropy Requirements

Refresh tokens must be server-generated using a cryptographically secure random source.
They must never be derived from user-supplied input, predictable sequences, or UUIDs alone.

Tokens are stored only as bcrypt hashes. The raw token is never persisted, logged, or
included in audit metadata. The `reason` field in `REFRESH_REPLAY_DETECTED` audit entries
contains only the string `'refresh_replay_detected'` — no token material.

Client-side token storage is outside the server's enforcement boundary, but the pilot
deployment guidance is: refresh tokens must be stored in memory or in HttpOnly cookies.
Local storage or non-HttpOnly cookies are not acceptable.
