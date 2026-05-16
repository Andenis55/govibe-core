export type VerifiedQrPayload = {
  ticketId: string;
  eventId: string;
  nonce: string;
  direction: 'ENTRY' | 'EXIT';
  sessionId: string;
  deviceBindingId?: string | null;
  issuedAt: Date;
  expiresAt: Date;
  signatureVersion: string;
};

export type QrTokenEnvelope = {
  alg: 'HMAC_SHA256' | 'ED25519';
  kid: string;
  payload: string;
  signature: string;
};