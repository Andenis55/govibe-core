import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '../config/config.service';
import { AuthenticatedRequestUser } from './types/authenticated-request-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: Record<string, unknown>): AuthenticatedRequestUser {
    const userId =
      typeof payload.userId === 'string'
        ? payload.userId
        : typeof payload.sub === 'string'
          ? payload.sub
          : undefined;
    const email =
      typeof payload.email === 'string' ? payload.email : undefined;

    if (!userId || !email) {
      throw new UnauthorizedException('Invalid JWT payload.');
    }

    return {
      userId,
      email,
      roles: Array.isArray(payload.roles)
        ? payload.roles.filter(
            (role): role is string => typeof role === 'string',
          )
        : [],
      permissions: Array.isArray(payload.permissions)
        ? payload.permissions.filter(
            (permission): permission is string =>
              typeof permission === 'string',
          )
        : [],
      organizerId:
        typeof payload.organizerId === 'string' ? payload.organizerId : null,
      deviceId: typeof payload.deviceId === 'string' ? payload.deviceId : null,
    };
  }
}