import { Global, Module } from '@nestjs/common';
import { OutboxProcessor } from './outbox.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaOutboxRepository } from './prisma-outbox.repository';
import { OUTBOX_REPOSITORY } from './outbox.providers';
import { OUTBOX_DISPATCHER } from './outbox.tokens';
import { OutboxService } from './outbox.service';
import { OutboxClaimRepository } from './outbox-claim.repository';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    OutboxService,
    OutboxProcessor,
    OutboxClaimRepository,
    {
      provide: OUTBOX_DISPATCHER,
      useValue: {
        async dispatch(): Promise<void> {
          return Promise.resolve();
        },
      },
    },
    {
      provide: OUTBOX_REPOSITORY,
      useClass: PrismaOutboxRepository,
    },
  ],
  exports: [
    OutboxService,
    OutboxProcessor,
    OUTBOX_REPOSITORY,
    OUTBOX_DISPATCHER,
  ],
})
export class OutboxModule {}