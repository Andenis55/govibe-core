import { Global, Module } from '@nestjs/common';
import { IDEMPOTENCY_REPOSITORY } from '../../modules/idempotency/idempotency.tokens';
import { PrismaIdempotencyRepository } from '../../modules/idempotency/infrastructure/repositories/prisma-idempotency.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { IdempotencyService } from './idempotency.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    IdempotencyService,
    {
      provide: IDEMPOTENCY_REPOSITORY,
      useClass: PrismaIdempotencyRepository,
    },
  ],
  exports: [IdempotencyService, IDEMPOTENCY_REPOSITORY],
})
export class IdempotencyModule {}