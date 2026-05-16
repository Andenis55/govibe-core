import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../logging/logger.service';
import {
  ProviderAuthError,
  ProviderNetworkError,
  ProviderResponseError,
  ProviderTimeoutError,
  WebhookSignatureError,
} from '../../modules/payments/domain/providers/provider-errors';
import { TelemetryService } from '../telemetry/telemetry.service';
import { OUTBOX_DISPATCHER } from './outbox.tokens';
import { OutboxClaimRepository } from './outbox-claim.repository';
import { OutboxDispatcher } from './outbox.dispatcher.interface';

@Injectable()
export class OutboxProcessor {
  private static readonly BATCH_SIZE = 100;
  private static readonly MAX_RETRIES = 10;

  constructor(
    private readonly claimRepository: OutboxClaimRepository,
    private readonly logger: AppLoggerService,
    private readonly telemetry: TelemetryService,
    @Inject(OUTBOX_DISPATCHER)
    private readonly dispatcher: OutboxDispatcher,
  ) {}

  async processBatch(): Promise<number> {
    const rows = await this.claimRepository.claimBatch(
      OutboxProcessor.BATCH_SIZE,
    );

    for (const row of rows) {
      try {
        await this.dispatcher.dispatch({
          id: row.id,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          eventType: row.eventType,
          payload: row.payload,
        });

        await this.claimRepository.markProcessed(row.id);
      } catch (error) {
        const nextRetryCount = row.retryCount + 1;
        const retryable = this.isRetryableError(error);
        const deadLetter =
          !retryable || nextRetryCount >= OutboxProcessor.MAX_RETRIES;
        const errorCode = this.getErrorCode(error);

        await this.claimRepository.markFailure(row.id, {
          retryCount: nextRetryCount,
          errorCode,
          retryable,
        });

        this.telemetry.record('outbox.processor.dispatch_failed', {
          eventId: row.id,
          eventType: row.eventType,
          retryCount: nextRetryCount,
          deadLetter,
          retryable,
          errorCode,
        });

        this.logger.warn(
          `Outbox event ${row.id} (${row.eventType}) failed dispatch, attempt ${nextRetryCount}/${OutboxProcessor.MAX_RETRIES}${deadLetter ? ', dead-lettered' : ''}`,
          OutboxProcessor.name,
        );
      }
    }

    if (rows.length > 0) {
      this.logger.log(
        `Outbox processor handled ${rows.length} event(s).`,
        OutboxProcessor.name,
      );
      this.telemetry.record('outbox.processor.completed', {
        processed: rows.length,
      });
    }

    return rows.length;
  }

  private isRetryableError(error: unknown): boolean {
    const errorName = (error as Error | undefined)?.name;

    if (error instanceof ProviderTimeoutError || error instanceof ProviderNetworkError) {
      return true;
    }

    if (error instanceof ProviderAuthError || error instanceof WebhookSignatureError) {
      return false;
    }

    if (
      errorName === 'ValidationError' ||
      errorName === 'SyntaxError' ||
      errorName === 'TypeError'
    ) {
      return false;
    }

    if (error instanceof ProviderResponseError) {
      return (
        error.statusCode === 0 ||
        error.statusCode >= 500 ||
        error.statusCode === 408 ||
        error.statusCode === 429
      );
    }

    return true;
  }

  private getErrorCode(error: unknown): string {
    if (error instanceof ProviderResponseError) {
      return error.code;
    }

    if (
      error instanceof ProviderAuthError ||
      error instanceof ProviderTimeoutError ||
      error instanceof ProviderNetworkError ||
      error instanceof WebhookSignatureError
    ) {
      return error.name;
    }

    return (error as Error | undefined)?.name ?? 'OUTBOX_DISPATCH_ERROR';
  }
}
