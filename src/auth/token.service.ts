import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppRole } from '../common/constants/roles';
import { AppConfigService } from '../shared/config/config.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.constants';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async issueAccessToken(params: {
    userId: string;
    email: string;
    role: AppRole;
    sessionId: string;
  }) {
    const jti = randomUUID();

    const payload: JwtPayload = {
      sub: params.userId,
      email: params.email,
      role: params.role,
      sessionId: params.sessionId,
      jti,
      type: 'access',
    };

    const token = await this.jwtService.signAsync(payload, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    return { token, jti, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  async issueRefreshToken() {
    const token = randomBytes(48).toString('base64url');

    return { token, expiresIn: REFRESH_TOKEN_TTL_SECONDS };
  }
}