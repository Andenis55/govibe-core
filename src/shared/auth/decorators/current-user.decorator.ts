import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequestUser } from '../types/authenticated-request-user.type';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedRequestUser | undefined => {
    const request = ctx.switchToHttp().getRequest<{
      user?: AuthenticatedRequestUser;
    }>();
    return request.user;
  },
);