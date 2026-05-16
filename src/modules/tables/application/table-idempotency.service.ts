import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export const TABLE_HOLD_IDEMPOTENCY_USE_CASE = 'tables.hold';

@Injectable()
export class TableIdempotencyService {
  hashIdempotencyKey(value: string): string {
    return this.hash(value.trim());
  }

  buildHoldRequestFingerprintHash(input: {
    eventId: string;
    eventTableId: string;
  }): string {
    return this.hash(
      JSON.stringify({
        eventId: input.eventId,
        eventTableId: input.eventTableId,
      }),
    );
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}