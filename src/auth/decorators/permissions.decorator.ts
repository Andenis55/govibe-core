import { SetMetadata } from '@nestjs/common';
import { AppPermission } from '../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../auth.constants';

export const Permissions = (...permissions: AppPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);