import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ClaimedOutboxEvent = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  retryCount: number;
};

@Injectable()
export class OutboxClaimRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimBatch(limit = 100): Promise<ClaimedOutboxEvent[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedOutboxEvent[]>(Prisma.sql`
        SELECT
          id,
          aggregate_type AS "aggregateType",
          aggregate_id   AS "aggregateId",
          event_type     AS "eventType",
          payload,
          retry_count    AS "retryCount"
        FROM outbox_events
        WHERE processed = false
          AND dead_lettered_at IS NULL
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `);

      if (rows.length === 0) {
        return [];
      }

      const claimedRows = rows.map((row) => ({
        ...row,
        payload:
          row.payload && typeof row.payload === 'object'
            ? row.payload
            : {},
      }));

      const ids = claimedRows.map((row) => row.id);

      await tx.outboxEvent.updateMany({
        where: {
          id: {
            in: ids,
          },
        },
        data: {
          nextAttemptAt: new Date(Date.now() + 30_000),
        },
      });

      return claimedRows;
    });
  }

  async markProcessed(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        processed: true,
        processedAt: new Date(),
        nextAttemptAt: null,
        lastErrorCode: null,
        deadLetteredAt: null,
      },
    });
  }

  async markFailure(
    eventId: string,
    input: {
      retryCount: number;
      errorCode: string;
      retryable: boolean;
    },
  ): Promise<void> {
    const deadLetter = !input.retryable || input.retryCount >= 10;
    const delaySeconds = Math.min(300, 2 ** Math.min(input.retryCount, 8));

    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        retryCount: input.retryCount,
        lastErrorCode: input.errorCode,
        nextAttemptAt: deadLetter
          ? null
          : new Date(Date.now() + delaySeconds * 1000),
        deadLetteredAt: deadLetter ? new Date() : null,
      },
    });
  }
}