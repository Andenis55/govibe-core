import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { AppPermission } from '../../common/constants/permissions';
import { AuthUser } from '../../common/types/auth-user.type';
import {
  AdminSupportListResponse,
  AdminSupportService,
} from './admin-support.service';
import { AdminLookupQueryDto } from './dto/admin-lookup-query.dto';
import { AdminAdmissionAuditResponseDto } from './dto/admin-admission-audit-response.dto';
import { AdminEventResponseDto } from './dto/admin-event-response.dto';
import { AdminOrganizerResponseDto } from './dto/admin-organizer-response.dto';
import { AdminPaymentResponseDto } from './dto/admin-payment-response.dto';
import { AdminSupportAuditLogResponseDto } from './dto/admin-support-audit-log-response.dto';
import { AdminTicketResponseDto } from './dto/admin-ticket-response.dto';
import { AdminUserResponseDto } from './dto/admin-user-response.dto';

@Controller('admin/support')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminSupportController {
  constructor(private readonly adminSupport: AdminSupportService) {}

  @Get('users')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_USERS)
  listUsers(
    @CurrentUser() user: AuthUser,
    @Query() query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminUserResponseDto>> {
    return this.adminSupport.listUsers(user.id, query);
  }

  @Get('users/:userId')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_USERS)
  getUser(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<AdminUserResponseDto> {
    return this.adminSupport.getUser(user.id, userId);
  }

  @Get('organizers')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_ORGANIZERS)
  listOrganizers(
    @CurrentUser() user: AuthUser,
    @Query() query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminOrganizerResponseDto>> {
    return this.adminSupport.listOrganizers(user.id, query);
  }

  @Get('organizers/:organizerId')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_ORGANIZERS)
  getOrganizer(
    @CurrentUser() user: AuthUser,
    @Param('organizerId', ParseUUIDPipe) organizerId: string,
  ): Promise<AdminOrganizerResponseDto> {
    return this.adminSupport.getOrganizer(user.id, organizerId);
  }

  @Get('events')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_EVENTS)
  listEvents(
    @CurrentUser() user: AuthUser,
    @Query() query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminEventResponseDto>> {
    return this.adminSupport.listEvents(user.id, query);
  }

  @Get('events/:eventId')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_EVENTS)
  getEvent(
    @CurrentUser() user: AuthUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<AdminEventResponseDto> {
    return this.adminSupport.getEvent(user.id, eventId);
  }

  @Get('payments')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_PAYMENTS)
  listPayments(
    @CurrentUser() user: AuthUser,
    @Query() query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminPaymentResponseDto>> {
    return this.adminSupport.listPayments(user.id, query);
  }

  @Get('payments/:paymentIntentId')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_PAYMENTS)
  getPayment(
    @CurrentUser() user: AuthUser,
    @Param('paymentIntentId', ParseUUIDPipe) paymentIntentId: string,
  ): Promise<AdminPaymentResponseDto> {
    return this.adminSupport.getPayment(user.id, paymentIntentId);
  }

  @Get('tickets')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_TICKETS)
  listTickets(
    @CurrentUser() user: AuthUser,
    @Query() query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminTicketResponseDto>> {
    return this.adminSupport.listTickets(user.id, query);
  }

  @Get('tickets/:ticketId')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_TICKETS)
  getTicket(
    @CurrentUser() user: AuthUser,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<AdminTicketResponseDto> {
    return this.adminSupport.getTicket(user.id, ticketId);
  }

  @Get('admission-scans')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_ADMISSIONS)
  listAdmissionScans(
    @CurrentUser() user: AuthUser,
    @Query() query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminAdmissionAuditResponseDto>> {
    return this.adminSupport.listAdmissionScans(user.id, query);
  }

  @Get('admission-scans/:scanAuditId')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_ADMISSIONS)
  getAdmissionScan(
    @CurrentUser() user: AuthUser,
    @Param('scanAuditId', ParseUUIDPipe) scanAuditId: string,
  ): Promise<AdminAdmissionAuditResponseDto> {
    return this.adminSupport.getAdmissionScan(user.id, scanAuditId);
  }

  @Get('audit-logs')
  @Permissions(AppPermission.ADMIN_SUPPORT_READ_AUDIT_LOGS)
  listAuditLogs(
    @CurrentUser() user: AuthUser,
    @Query() query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminSupportAuditLogResponseDto>> {
    return this.adminSupport.listAuditLogs(user.id, query);
  }
}
