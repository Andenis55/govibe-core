import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LaunchControlService } from './launch-control.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [LaunchControlService],
  exports: [LaunchControlService],
})
export class LaunchControlModule {}