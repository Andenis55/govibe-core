import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ROLE_PERMISSIONS } from '../auth.types';
import { AuthUser } from '../../common/types/auth-user.type';
import { AppConfigService } from '../../shared/config/config.service';
import { ACCESS_TOKEN_STRATEGY } from '../auth.constants';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { SessionService } from '../session.service';

@Injectable()
export class AccessTokenStrategy extends PassportStrategy(
  Strategy,
  ACCESS_TOKEN_STRATEGY,
) {
  constructor(
    private readonly sessions: SessionService,
    config: AppConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('invalid access token');
    }

    const session = await this.sessions.assertSessionUsable(payload.sessionId);

    return {
      id: session.user.id,
      email: session.user.email,
      role: payload.role,
      sessionId: session.id,
      permissions: ROLE_PERMISSIONS[payload.role] ?? [],
      emailVerifiedAt: session.user.emailVerifiedAt,
      isActive: session.user.isActive,
      createdAt: session.user.createdAt,
      updatedAt: session.user.updatedAt,
    };
  }
}