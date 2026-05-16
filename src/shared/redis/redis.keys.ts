export const redisKeys = {
  qrNonce: (eventId: string, ticketId: string, nonce: string) =>
    `qr_nonce:${eventId}:${ticketId}:${nonce}`,
  admissionState: (ticketId: string) => `admission_state:${ticketId}`,
  revokedTicket: (ticketId: string) => `revoked_ticket:${ticketId}`,
  paymentWebhookLock: (provider: string, providerRef: string) =>
    `payment_lock:${provider}:${providerRef}`,
};