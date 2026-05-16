import { z } from 'zod';

export const qrPayloadSchema = z
  .object({
    ticketId: z.string().uuid(),
    eventId: z.string().uuid(),
    nonce: z.string().min(8).max(256),
    direction: z.enum(['ENTRY', 'EXIT']),
    sessionId: z.string().min(8).max(256),
    deviceBindingId: z.string().min(1).max(256).nullable().optional(),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    signatureVersion: z.string().min(1).max(64),
  })
  .superRefine((value, ctx) => {
    const issuedAt = new Date(value.issuedAt);
    const expiresAt = new Date(value.expiresAt);

    if (issuedAt > expiresAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'issuedAt must be <= expiresAt',
      });
    }

    const lifetimeMs = expiresAt.getTime() - issuedAt.getTime();
    if (lifetimeMs > 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'QR token lifetime exceeds maximum allowed window',
      });
    }
  });

export type QrPayload = z.infer<typeof qrPayloadSchema>;