import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SessionStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../shared/prisma/prisma.service';
import { AuthAuditService } from './auth-audit.service';
import { AuthAuditAction } from '@prisma/client';
import { REFRESH_TOKEN_TTL_SECONDS } from './auth.constants';

export class RefreshReplayError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly reason:
      | 'device_mismatch'
      | 'rotated_refresh_token_reused'
      | 'concurrent_rotation',
  ) {
    super('refresh replay detected');
    this.name = 'RefreshReplayError';
  }
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authAuditService: AuthAuditService,
  ) {}

  generateSessionId(): string {
    return randomUUID();
  }

  async createSession(params: {
    sessionId: string;
    userId: string;
    deviceId: string;
    refreshToken: string;
    userAgent?: string;
    ipAddress?: string;
  }) {
    const now = new Date();

    return this.prisma.session.create({
      data: {
        id: params.sessionId,
        userId: params.userId,
        deviceId: params.deviceId,
        refreshTokenHash: this.hashRefreshToken(params.refreshToken),
        previousRefreshTokenHash: null,
        refreshTokenVersion: 0,
        userAgent: params.userAgent,
        ipAddress: params.ipAddress,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
        status: SessionStatus.ACTIVE,
      },
    });
  }

  async assertSessionUsable(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedException('session not found');
    }

    if (session.status === SessionStatus.REVOKED) {
      throw new UnauthorizedException('session revoked');
    }

    if (session.expiresAt.getTime() < Date.now()) {
      await this.markExpired(session.id);
      throw new UnauthorizedException('session expired');
    }

    if (session.status !== SessionStatus.ACTIVE) {
      throw new UnauthorizedException('session not active');
    }

    if (!session.user.isActive) {
      throw new UnauthorizedException('user inactive');
    }

    return session;
  }

  async rotateRefreshToken(params: {
    refreshToken: string;
    deviceId: string;
    nextRefreshToken: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const incomingRefreshTokenHash = this.hashRefreshToken(params.refreshToken);
    const session = await this.prisma.session.findFirst({
      where: {
        OR: [
          { refreshTokenHash: incomingRefreshTokenHash },
          { previousRefreshTokenHash: incomingRefreshTokenHash },
        ],
      },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedException('invalid refresh token');
    }

    if (session.deviceId !== params.deviceId) {
      await this.revokeForReplay(session.id, 'device_mismatch');
      throw new RefreshReplayError(session.id, 'device_mismatch');
    }

    if (session.status === SessionStatus.REVOKED) {
      throw new UnauthorizedException('session revoked');
    }

    if (session.expiresAt.getTime() < Date.now()) {
      await this.markExpired(session.id);
      throw new UnauthorizedException('session expired');
    }

    if (session.status !== SessionStatus.ACTIVE) {
      throw new UnauthorizedException('session not active');
    }

    if (!session.user.isActive) {
      throw new UnauthorizedException('user inactive');
    }

    if (session.previousRefreshTokenHash === incomingRefreshTokenHash) {
      await this.revokeForReplay(session.id, 'rotated_refresh_token_reused');
      throw new RefreshReplayError(session.id, 'rotated_refresh_token_reused');
    }

    if (session.refreshTokenHash !== incomingRefreshTokenHash) {
      throw new UnauthorizedException('invalid refresh token');
    }

    const now = new Date();
    const nextRefreshTokenHash = this.hashRefreshToken(params.nextRefreshToken);
    const updateResult = await this.prisma.session.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: incomingRefreshTokenHash,
        revokedAt: null,
        status: SessionStatus.ACTIVE,
      },
      data: {
        previousRefreshTokenHash: incomingRefreshTokenHash,
        refreshTokenHash: nextRefreshTokenHash,
        refreshTokenVersion: {
          increment: 1,
        },
        lastSeenAt: now,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });

    if (updateResult.count !== 1) {
      await this.revokeForReplay(session.id, 'concurrent_rotation');
      throw new RefreshReplayError(session.id, 'concurrent_rotation');
    }

    return this.prisma.session.findUniqueOrThrow({
      where: { id: session.id },
      include: { user: true },
    });
  }

  async revokeSession(params: {
    requesterUserId: string;
    sessionId: string;
    reason: string;
    allowAny?: boolean;
  }) {
    const session = await this.prisma.session.findUnique({
      where: { id: params.sessionId },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedException('session not found');
    }

    if (session.userId !== params.requesterUserId && !params.allowAny) {
      throw new ForbiddenException('cannot revoke another user session');
    }

    if (session.status === SessionStatus.REVOKED) {
      return session;
    }

    await this.prisma.session.update({
      where: { id: params.sessionId },
      data: {
        status: SessionStatus.REVOKED,
        revokedAt: new Date(),
        revokedReason: params.reason,
        refreshTokenHash: null,
        previousRefreshTokenHash: null,
      },
    });

    return session;
  }

  async markExpired(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session) {
      return;
    }

    const now = new Date();

    const result = await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        status: SessionStatus.ACTIVE,
      },
      data: {
        status: SessionStatus.EXPIRED,
        revokedAt: now,
        revokedReason: 'expired_session_detected',
        refreshTokenHash: null,
        previousRefreshTokenHash: null,
      },
    });

    if (result.count > 0) {
      await this.authAuditService.log({
        action: AuthAuditAction.EXPIRED_SESSION_DETECTED,
        success: false,
        userId: session.userId,
        email: session.user?.email,
        sessionId: session.id,
        reason: 'expired_session_detected',
      });
    }
  }

  async getSessionById(sessionId: string) {
    return this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
  }

  private async revokeForReplay(
    sessionId: string,
    reason: 'device_mismatch' | 'rotated_refresh_token_reused' | 'concurrent_rotation',
  ) {
    await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        status: { not: SessionStatus.REVOKED },
      },
      data: {
        status: SessionStatus.REVOKED,
        revokedAt: new Date(),
        revokedReason: reason,
        refreshTokenHash: null,
        previousRefreshTokenHash: null,
      },
    });
  }

  private hashRefreshToken(refreshToken: string): string {
    return createHash('sha256').update(refreshToken).digest('hex');
  }
}