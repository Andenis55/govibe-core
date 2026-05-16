import { AppPermission } from '../constants/permissions';
import { AppRole } from '../constants/roles';

export type AuthUser = {
  id: string;
  email: string;
  role: AppRole;
  sessionId: string;
  permissions: AppPermission[];
  emailVerifiedAt: Date | null;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};