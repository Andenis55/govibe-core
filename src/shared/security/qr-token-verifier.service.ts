import { Buffer } from 'node:buffer';
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual, verify } from 'node:crypto';
import { InvalidStateTransitionError } from '../errors/domain-errors';
import { qrPayloadSchema } from './qr-payload.schema';
import { SignatureKeyStoreService } from './signature-key-store.service';
import { QrTokenEnvelope, VerifiedQrPayload } from './qr.types';

@Injectable()
export class QrTokenVerifierService {
  constructor(private readonly keyStore: SignatureKeyStoreService) {}

  async verify(rawToken: string): Promise<VerifiedQrPayload> {
    const decodedEnvelope = this.decodeEnvelope(rawToken);

    const payloadBuffer = Buffer.from(decodedEnvelope.payload, 'base64url');
    const signatureBuffer = Buffer.from(decodedEnvelope.signature, 'base64url');

    if (decodedEnvelope.alg === 'HMAC_SHA256') {
      const secret = this.keyStore.getHmacSecret(decodedEnvelope.kid);
      const expected = createHmac('sha256', secret).update(payloadBuffer).digest();

      if (
        expected.length !== signatureBuffer.length ||
        !timingSafeEqual(expected, signatureBuffer)
      ) {
        throw new InvalidStateTransitionError('Invalid HMAC QR signature.');
      }
    } else if (decodedEnvelope.alg === 'ED25519') {
      const publicKeyPem = this.keyStore.getEd25519PublicKey(decodedEnvelope.kid);
      const ok = verify(null, payloadBuffer, publicKeyPem, signatureBuffer);

      if (!ok) {
        throw new InvalidStateTransitionError('Invalid Ed25519 QR signature.');
      }
    } else {
      throw new InvalidStateTransitionError('Unsupported QR algorithm.');
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(payloadBuffer.toString('utf8'));
    } catch {
      throw new InvalidStateTransitionError('Malformed QR payload JSON.');
    }

    const payloadResult = qrPayloadSchema.safeParse(parsedJson);

    if (!payloadResult.success) {
      const issue = payloadResult.error.issues[0]?.message ?? 'Invalid QR payload.';
      throw new InvalidStateTransitionError(issue);
    }

    const payload = payloadResult.data;

    const verified: VerifiedQrPayload = {
      ticketId: payload.ticketId,
      eventId: payload.eventId,
      nonce: payload.nonce,
      direction: payload.direction,
      sessionId: payload.sessionId,
      deviceBindingId: payload.deviceBindingId ?? null,
      issuedAt: new Date(payload.issuedAt),
      expiresAt: new Date(payload.expiresAt),
      signatureVersion: payload.signatureVersion,
    };

    if (Number.isNaN(verified.issuedAt.getTime())) {
      throw new InvalidStateTransitionError('Invalid QR issued timestamp.');
    }

    if (Number.isNaN(verified.expiresAt.getTime())) {
      throw new InvalidStateTransitionError('Invalid QR expiry timestamp.');
    }

    return verified;
  }

  private decodeEnvelope(rawToken: string): QrTokenEnvelope {
    let parsed: QrTokenEnvelope;

    try {
      parsed = JSON.parse(
        Buffer.from(rawToken, 'base64url').toString('utf8'),
      ) as QrTokenEnvelope;
    } catch {
      throw new InvalidStateTransitionError('Malformed QR token envelope.');
    }

    if (!parsed.alg || !parsed.kid || !parsed.payload || !parsed.signature) {
      throw new InvalidStateTransitionError('Malformed QR token envelope.');
    }

    return parsed;
  }
}