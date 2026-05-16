import { UserRole } from '@prisma/client';

export class AdminUserResponseDto {
  id!: string;
  email!: string;
  role!: UserRole;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
