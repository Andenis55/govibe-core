import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AdminActionStatus, Prisma } from '@prisma/client';
import {
  AdminSupportRepository,
  CreateAdminSupportAuditLogInput,
} from './admin-support.repository';
import { AdminSupportRedactionService } from './admin-support-redaction.service';

@Injectable()
export class AdminSupportAuditService {
  constructor(
    private readonly repository: AdminSupportRepository,
    private readonly redaction: AdminSupportRedactionService,
  ) {}

  async recordRead(input: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const data: CreateAdminSupportAuditLogInput = {
      actorUserId: input.actorUserId,
      action: input.action,
      status: AdminActionStatus.SUCCEEDED,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      reasonCode: 'SUPPORT_READ',
      metadata: this.toInputJsonObject(
        this.redaction.redactResponse(input.metadata) as Record<string, unknown>,
      ),
    };

    try {
      await this.repository.createAuditLog(data);
    } catch {
      throw new InternalServerErrorException('Internal server error');
    }
  }

  private toInputJsonObject(
    value: Record<string, unknown>,
  ): Prisma.InputJsonObject {
    return value as Prisma.InputJsonObject;
  }
}
