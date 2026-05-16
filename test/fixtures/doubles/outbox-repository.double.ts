import { OutboxRepository } from '../../../src/shared/outbox/outbox.repository.interface';
import { TxClient } from '../../../src/shared/prisma/prisma.types';

type OutboxAppendInput = Parameters<OutboxRepository['append']>[0];

export class OutboxRepositoryDouble implements OutboxRepository {
  public readonly events: OutboxAppendInput[] = [];

  async append(input: OutboxAppendInput, _tx: TxClient): Promise<void> {
    this.events.push(input);
  }
}