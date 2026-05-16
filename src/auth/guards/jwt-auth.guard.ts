import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AppRole } from '../../common/constants/roles';
import { AuthUser } from '../../common/types/auth-user.type';
import { RequestContextService } from '../../shared/context/request-context.service';
import { ACCESS_TOKEN_STRATEGY, IS_PUBLIC_KEY } from '../auth.constants';

@Injectable()
export class JwtAuthGuard extends AuthGuard(ACCESS_TOKEN_STRATEGY) {
  constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: RequestContextService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    err: unknown,
    user: AuthUser | null,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }

      throw new UnauthorizedException('Unauthorized');
    }

    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }

    const request = context.switchToHttp().getRequest<{
      user?: unknown;
      auth?: unknown;
      session?: { id: string };
    }>();
    request.user = user;
    request.auth = user;
    request.session = { id: user.sessionId };
    this.requestContext.set({
      userId: user.id,
      organizerId: user.role === AppRole.ORGANIZER ? user.id : undefined,
    });

    return user as TUser;
  }
}