import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TransactionRunnerService } from './transaction-runner.service';

@Global()
@Module({
  providers: [PrismaService, TransactionRunnerService],
  exports: [PrismaService, TransactionRunnerService],
})
export class PrismaModule {}