import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { TransactionRunnerService } from '../prisma/transaction-runner.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { OutboxProcessor } from './outbox.processor';
import { OutboxRepository } from './outbox.repository.interface';
import { OUTBOX_REPOSITORY } from './outbox.tokens';

const DEFAULT_OUTBOX_BATCH_SIZE = 100;

@Injectable()
export class OutboxService {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    private readonly telemetry: TelemetryService,
    private readonly outboxProcessor: OutboxProcessor,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async enqueue(
    eventType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
    aggregateType = 'generic',
  ): Promise<void> {
    await this.transactionRunner.runInTransaction(async (tx) => {
      await this.outboxRepository.append(
        {
          id: randomUUID(),
          aggregateType,
          aggregateId,
          eventType,
          payload,
        },
        tx,
      );
    });
  }

  async dispatchPendingBatch(limit = DEFAULT_OUTBOX_BATCH_SIZE): Promise<number> {
    if (limit !== DEFAULT_OUTBOX_BATCH_SIZE) {
      this.telemetry.record('outbox.processor.enforced_batch_size', {
        requestedLimit: limit,
        enforcedLimit: DEFAULT_OUTBOX_BATCH_SIZE,
      });
    }

    return this.outboxProcessor.processBatch();
  }
}