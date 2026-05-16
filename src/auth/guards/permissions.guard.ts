import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppPermission } from '../../common/constants/permissions';
import { AppRole } from '../../common/constants/roles';
import { PERMISSIONS_KEY } from '../auth.constants';
import { ROLE_PERMISSIONS } from '../auth.types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<AppPermission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { role?: AppRole };
    }>();
    const user = request.user;

    if (!user?.role) {
      throw new ForbiddenException('missing user');
    }

    const granted = ROLE_PERMISSIONS[user.role] ?? [];
    const hasAll = requiredPermissions.every((permission) =>
      granted.includes(permission),
    );

    if (!hasAll) {
      throw new ForbiddenException('insufficient permissions');
    }

    return true;
  }
}