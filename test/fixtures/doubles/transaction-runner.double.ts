import { TransactionRunnerService } from '../../../src/shared/prisma/transaction-runner.service';
import { TxClient } from '../../../src/shared/prisma/prisma.types';

export class TransactionRunnerDouble {
  public readonly client = {} as TxClient;

  async runInTransaction<T>(
    fn: (tx: TxClient) => Promise<T>,
  ): Promise<T> {
    return fn(this.client);
  }

  asService(): TransactionRunnerService {
    return this as unknown as TransactionRunnerService;
  }
}