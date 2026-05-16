import { AdminActionStatus } from '@prisma/client';

export class AdminSupportAuditLogResponseDto {
  id!: string;
  actorUserId!: string;
  action!: string;
  status!: AdminActionStatus;
  targetType!: string | null;
  targetId!: string | null;
  reasonCode!: string;
  reasonNote!: string | null;
  metadata!: Record<string, unknown> | null;
  createdAt!: Date;
}
