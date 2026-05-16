import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthAuditAction, User, UserRole } from '@prisma/client';
import { Request } from 'express';
import { AppRole } from '../common/constants/roles';
import { UsersService } from '../users/users.service';
import { AuthAuditService } from './auth-audit.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RevokeSessionDto } from './dto/revoke-session.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { PasswordService } from './password.service';
import { SessionService, RefreshReplayError } from './session.service';
import { TokenService } from './token.service';

type AuthenticatedPrincipal = {
  id: string;
  email: string;
  role: UserRole;
  emailVerifiedAt: Date | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly authAuditService: AuthAuditService,
  ) {}

  async signup(dto: SignupDto, req: Request) {
    const existing = await this.usersService.findByEmail(dto.email);

    if (existing) {
      throw new ConflictException('email already registered');
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const user = await this.usersService.createUser({
      email: dto.email,
      passwordHash,
      role: AppRole.CUSTOMER,
    });

    return this.issueSession(user, dto.deviceId, req, AuthAuditAction.SIGNUP);
  }

  async login(dto: LoginDto, req: Request) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      await this.authAuditService.log({
        action: AuthAuditAction.AUTH_FAILURE,
        success: false,
        email: dto.email.trim().toLowerCase(),
        ipAddress: this.ip(req),
        userAgent: this.userAgent(req),
        reason: 'user_not_found',
      });
      throw new UnauthorizedException('invalid credentials');
    }

    const valid = await this.passwordService.compare(dto.password, user.passwordHash);

    if (!valid) {
      await this.authAuditService.log({
        action: AuthAuditAction.AUTH_FAILURE,
        success: false,
        userId: user.id,
        email: user.email,
        ipAddress: this.ip(req),
        userAgent: this.userAgent(req),
        reason: 'invalid_password',
      });
      throw new UnauthorizedException('invalid credentials');
    }

    if (!user.isActive) {
      await this.authAuditService.log({
        action: AuthAuditAction.AUTH_FAILURE,
        success: false,
        userId: user.id,
        email: user.email,
        ipAddress: this.ip(req),
        userAgent: this.userAgent(req),
        reason: 'inactive_user',
      });
      throw new UnauthorizedException('inactive user');
    }

    return this.issueSession(user, dto.deviceId, req, AuthAuditAction.LOGIN);
  }

  async refresh(dto: RefreshTokenDto, req: Request) {
    const nextRefresh = await this.tokenService.issueRefreshToken();

    let session;
    try {
      session = await this.sessionService.rotateRefreshToken({
        refreshToken: dto.refreshToken,
        deviceId: dto.deviceId,
        nextRefreshToken: nextRefresh.token,
        ipAddress: this.ip(req),
        userAgent: this.userAgent(req),
      });
    } catch (error) {
      if (error instanceof RefreshReplayError) {
        const replayedSession = await this.sessionService.getSessionById(
          error.sessionId,
        );

        await this.authAuditService.log({
          action: AuthAuditAction.REFRESH_REPLAY_DETECTED,
          success: false,
          userId: replayedSession?.userId,
          email: replayedSession?.user?.email,
          sessionId: error.sessionId,
          ipAddress: this.ip(req),
          userAgent: this.userAgent(req),
          reason: error.reason,
          metadata: {
            reason: error.reason,
          },
        });
        throw new UnauthorizedException('invalid refresh token');
      }

      await this.authAuditService.log({
        action: AuthAuditAction.AUTH_FAILURE,
        success: false,
        ipAddress: this.ip(req),
        userAgent: this.userAgent(req),
        reason: error instanceof Error ? error.message : 'refresh_validation_failed',
      });
      throw error;
    }

    const access = await this.tokenService.issueAccessToken({
      userId: session.user.id,
      email: session.user.email,
      role: this.toAppRole(session.user.role),
      sessionId: session.id,
    });

    await this.authAuditService.log({
      action: AuthAuditAction.REFRESH,
      success: true,
      userId: session.user.id,
      email: session.user.email,
      sessionId: session.id,
      ipAddress: this.ip(req),
      userAgent: this.userAgent(req),
    });

    return this.authResponse(session.user, session.id, access, nextRefresh);
  }

  async logout(
    currentUser: { id: string; email: string },
    sessionId: string,
    dto: LogoutDto,
    req: Request,
  ) {
    await this.sessionService.revokeSession({
      requesterUserId: currentUser.id,
      sessionId,
      reason: dto.reason ?? 'logout',
    });

    await this.authAuditService.log({
      action: AuthAuditAction.LOGOUT,
      success: true,
      userId: currentUser?.id,
      email: currentUser?.email,
      sessionId,
      ipAddress: this.ip(req),
      userAgent: this.userAgent(req),
      reason: dto.reason ?? 'logout',
    });

    return { success: true };
  }

  async revokeSession(
    currentUser: { id: string; email: string; role: AppRole },
    dto: RevokeSessionDto,
    req: Request,
  ) {
    const revoked = await this.sessionService.revokeSession({
      requesterUserId: currentUser.id,
      sessionId: dto.sessionId,
      reason: dto.reason ?? 'manual_revoke',
      allowAny: currentUser.role === AppRole.ADMIN,
    });

    await this.authAuditService.log({
      action: AuthAuditAction.SESSION_REVOKED,
      success: true,
      userId: currentUser.id,
      email: currentUser.email,
      sessionId: revoked.id,
      ipAddress: this.ip(req),
      userAgent: this.userAgent(req),
      reason: dto.reason ?? 'manual_revoke',
      metadata: {
        revokedUserId: revoked.userId,
      },
    });

    return { success: true, sessionId: revoked.id };
  }

  async me(
    currentUser: { id: string; email: string; role: AppRole; emailVerifiedAt: Date | null },
    sessionId: string,
  ) {
    const session = await this.sessionService.assertSessionUsable(sessionId);

    if (session.userId !== currentUser.id) {
      throw new UnauthorizedException('session does not belong to current user');
    }

    await this.authAuditService.log({
      action: AuthAuditAction.ME_ACCESSED,
      success: true,
      userId: currentUser.id,
      email: currentUser.email,
      sessionId: session.id,
    });

    return {
      user: {
        id: currentUser.id,
        email: currentUser.email,
        role: currentUser.role,
        emailVerifiedAt: currentUser.emailVerifiedAt,
      },
      session: {
        id: session.id,
      },
    };
  }

  private async issueSession(
    user: User,
    deviceId: string,
    req: Request,
    action: AuthAuditAction,
  ) {
    const sessionId = this.sessionService.generateSessionId();
    const refresh = await this.tokenService.issueRefreshToken();

    await this.sessionService.createSession({
      sessionId,
      userId: user.id,
      deviceId,
      refreshToken: refresh.token,
      ipAddress: this.ip(req),
      userAgent: this.userAgent(req),
    });

    const access = await this.tokenService.issueAccessToken({
      userId: user.id,
      email: user.email,
      role: this.toAppRole(user.role),
      sessionId,
    });

    await this.authAuditService.log({
      action,
      success: true,
      userId: user.id,
      email: user.email,
      sessionId,
      ipAddress: this.ip(req),
      userAgent: this.userAgent(req),
    });

    return this.authResponse(user, sessionId, access, refresh);
  }

  private authResponse(
    user: AuthenticatedPrincipal,
    sessionId: string,
    access: { token: string; expiresIn: number },
    refresh: { token: string; expiresIn: number },
  ) {
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerifiedAt: user.emailVerifiedAt,
      },
      session: {
        id: sessionId,
      },
      tokens: {
        accessToken: access.token,
        accessTokenExpiresIn: access.expiresIn,
        refreshToken: refresh.token,
        refreshTokenExpiresIn: refresh.expiresIn,
      },
    };
  }

  private ip(req: Request): string | undefined {
    const forwardedFor = req.headers['x-forwarded-for'];

    if (Array.isArray(forwardedFor)) {
      return forwardedFor[0]?.split(',')[0]?.trim();
    }

    if (typeof forwardedFor === 'string') {
      return forwardedFor.split(',')[0]?.trim();
    }

    return req.ip;
  }

  private userAgent(req: Request): string | undefined {
    const userAgent = req.headers['user-agent'];
    return Array.isArray(userAgent) ? userAgent[0] : userAgent;
  }

  private toAppRole(role: UserRole): AppRole {
    return role as AppRole;
  }
}