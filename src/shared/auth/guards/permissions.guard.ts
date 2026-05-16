import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../types/authenticated-request-user.type';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedRequestUser;
    }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authenticated user required.');
    }

    const allowed = requiredPermissions.every((permission) =>
      user.permissions.includes(permission),
    );

    if (!allowed) {
      throw new ForbiddenException('Missing required permissions.');
    }

    return true;
  }
}