import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { RequestContextService } from '../../context/request-context.service';
import { AuthenticatedRequestUser } from '../types/authenticated-request-user.type';

@Injectable()
export class JwtAuthGuard extends PassportAuthGuard('jwt') {
  constructor(private readonly requestContext: RequestContextService) {
    super();
  }

  handleRequest<TUser = AuthenticatedRequestUser>(
    err: unknown,
    user: unknown,
    info: unknown,
    context: ExecutionContext,
    _status?: unknown,
  ): TUser {
    const authenticatedUser = user as AuthenticatedRequestUser | undefined;

    if (err || !authenticatedUser) {
      const message =
        info instanceof Error
          ? info.message
          : 'Authenticated user required.';

      throw err ?? new UnauthorizedException(message);
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedRequestUser;
    }>();
    request.user = authenticatedUser;
    this.requestContext.set({
      userId: authenticatedUser.userId,
      deviceId: authenticatedUser.deviceId ?? undefined,
      organizerId: authenticatedUser.organizerId ?? undefined,
    });

    return authenticatedUser as TUser;
  }
}