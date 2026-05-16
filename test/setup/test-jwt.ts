import { createHmac } from 'node:crypto';

type TestJwtClaims = {
  userId: string;
  email: string;
  roles?: readonly string[];
  permissions?: readonly string[];
  organizerId?: string | null;
  deviceId?: string | null;
  expiresInSeconds?: number;
};

export function signTestJwt(input: TestJwtClaims): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: input.userId,
    userId: input.userId,
    email: input.email,
    roles: input.roles ?? [],
    permissions: input.permissions ?? [],
    organizerId: input.organizerId ?? null,
    deviceId: input.deviceId ?? null,
    iat: now,
    exp: now + (input.expiresInSeconds ?? 3600),
  };
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };
  const encodedHeader = encodeSegment(header);
  const encodedPayload = encodeSegment(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac(
    'sha256',
    process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-123456',
  )
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}