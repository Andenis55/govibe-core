import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AppPermission } from '../common/constants/permissions';
import { AppRole } from '../common/constants/roles';
import { AuthService } from './auth.service';
import { CurrentSession } from './decorators/current-session.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Permissions } from './decorators/permissions.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RevokeSessionDto } from './dto/revoke-session.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesGuard } from './guards/roles.guard';

@Controller('auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.authService.signup(dto, req);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto, req);
  }

  @Post('logout')
  @Permissions(AppPermission.SESSION_REVOKE_OWN)
  logout(
    @CurrentUser() user: { id: string; email: string; role: AppRole },
    @CurrentSession() session: { id: string },
    @Body() dto: LogoutDto,
    @Req() req: Request,
  ) {
    return this.authService.logout(user, session.id, dto, req);
  }

  @Post('revoke-session')
  @Permissions(AppPermission.SESSION_REVOKE_OWN)
  revokeSession(
    @CurrentUser() user: { id: string; email: string; role: AppRole },
    @Body() dto: RevokeSessionDto,
    @Req() req: Request,
  ) {
    return this.authService.revokeSession(user, dto, req);
  }

  @Get('me')
  @Permissions(AppPermission.AUTHENTICATED)
  me(
    @CurrentUser()
    user: { id: string; email: string; role: AppRole; emailVerifiedAt: Date | null },
    @CurrentSession() session: { id: string },
  ) {
    return this.authService.me(user, session.id);
  }

  @Get('customer-only')
  @Roles(AppRole.CUSTOMER)
  @Permissions(AppPermission.CUSTOMER_ACCESS)
  customerOnly() {
    return { ok: true, area: 'customer' };
  }

  @Get('organizer-only')
  @Roles(AppRole.ORGANIZER)
  @Permissions(AppPermission.ORGANIZER_ACCESS)
  organizerOnly() {
    return { ok: true, area: 'organizer' };
  }

  @Get('gate-only')
  @Roles(AppRole.GATE_STAFF)
  @Permissions(AppPermission.GATE_STAFF_ACCESS)
  gateOnly() {
    return { ok: true, area: 'gate' };
  }

  @Get('admin-only')
  @Roles(AppRole.ADMIN)
  @Permissions(AppPermission.ADMIN_ACCESS)
  adminOnly() {
    return { ok: true, area: 'admin' };
  }
}