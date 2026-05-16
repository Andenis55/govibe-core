export type VerifiedQrPayload = {
  ticketId: string;
  eventId: string;
  nonce: string;
  direction: 'ENTRY' | 'EXIT';
  sessionId: string;
  deviceBindingId?: string | null;
  expiresAt: Date;
};

export interface QrTokenVerifier {
  verify(rawToken: string): Promise<VerifiedQrPayload>;
}