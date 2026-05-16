import { Injectable } from '@nestjs/common';
import { AuthAuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

@Injectable()
export class AuthAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    action: AuthAuditAction;
    success: boolean;
    userId?: string;
    email?: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.prisma.authAuditLog.create({
      data: {
        action: params.action,
        success: params.success,
        userId: params.userId,
        email: params.email,
        sessionId: params.sessionId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        reason: params.reason,
        metadata: params.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }
}