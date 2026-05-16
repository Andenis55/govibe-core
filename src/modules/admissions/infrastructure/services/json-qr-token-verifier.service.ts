import { Buffer } from 'node:buffer';
import { Injectable } from '@nestjs/common';
import { InvalidStateTransitionError } from '../../../../shared/errors/domain-errors';
import {
  QrTokenVerifier,
  VerifiedQrPayload,
} from '../../domain/services/qr-token-verifier.interface';

type RawQrPayload = {
  ticketId?: unknown;
  eventId?: unknown;
  nonce?: unknown;
  direction?: unknown;
  sessionId?: unknown;
  deviceBindingId?: unknown;
  expiresAt?: unknown;
};

@Injectable()
export class JsonQrTokenVerifierService implements QrTokenVerifier {
  async verify(rawToken: string): Promise<VerifiedQrPayload> {
    const payload = this.parsePayload(rawToken);
    const direction = this.getDirection(payload.direction);
    const expiresAt = this.getDate(payload.expiresAt, 'expiresAt');

    return {
      ticketId: this.getString(payload.ticketId, 'ticketId'),
      eventId: this.getString(payload.eventId, 'eventId'),
      nonce: this.getString(payload.nonce, 'nonce'),
      direction,
      sessionId: this.getString(payload.sessionId, 'sessionId'),
      deviceBindingId: this.getOptionalString(
        payload.deviceBindingId,
        'deviceBindingId',
      ),
      expiresAt,
    };
  }

  private parsePayload(rawToken: string): RawQrPayload {
    const candidates = [rawToken, this.decodeBase64Url(rawToken)];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      try {
        return JSON.parse(candidate) as RawQrPayload;
      } catch {
        continue;
      }
    }

    throw new InvalidStateTransitionError('Invalid QR token payload.');
  }

  private decodeBase64Url(value: string): string | null {
    try {
      return Buffer.from(value, 'base64url').toString('utf8');
    } catch {
      return null;
    }
  }

  private getDirection(value: unknown): 'ENTRY' | 'EXIT' {
    if (value === 'ENTRY' || value === 'EXIT') {
      return value;
    }

    throw new InvalidStateTransitionError('Invalid QR direction.');
  }

  private getDate(value: unknown, field: string): Date {
    const date = new Date(this.getString(value, field));

    if (Number.isNaN(date.getTime())) {
      throw new InvalidStateTransitionError(`Invalid QR ${field}.`);
    }

    return date;
  }

  private getString(value: unknown, field: string): string {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }

    throw new InvalidStateTransitionError(`Invalid QR ${field}.`);
  }

  private getOptionalString(value: unknown, field: string): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    return this.getString(value, field);
  }
}