import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { AdminSupportAuditService } from './admin-support-audit.service';
import { AdminSupportController } from './admin-support.controller';
import { AdminSupportRedactionService } from './admin-support-redaction.service';
import { AdminSupportRepository } from './admin-support.repository';
import { AdminSupportService } from './admin-support.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AdminSupportController],
  providers: [
    AdminSupportService,
    AdminSupportRepository,
    AdminSupportAuditService,
    AdminSupportRedactionService,
  ],
})
export class AdminSupportModule {}
