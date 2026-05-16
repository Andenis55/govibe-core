import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../shared/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/auth/guards/jwt-auth.guard';
import { AuthenticatedRequestUser } from '../../../shared/auth/types/authenticated-request-user.type';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  @Get('me')
  me(@CurrentUser() user: AuthenticatedRequestUser): AuthenticatedRequestUser {
    return user;
  }
}