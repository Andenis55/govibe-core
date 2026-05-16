import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, User, UserRole } from '@prisma/client';
import { AppRole } from '../common/constants/roles';
import { PrismaService } from '../shared/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(email) },
    });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async createUser(params: {
    email: string;
    passwordHash: string;
    role?: AppRole;
  }): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          email: this.normalizeEmail(params.email),
          passwordHash: params.passwordHash,
          role: (params.role ?? AppRole.CUSTOMER) as UserRole,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('email already registered');
      }

      throw error;
    }
  }

  async setActive(userId: string, isActive: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
    });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}