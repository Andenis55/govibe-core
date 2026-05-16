import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { AppPermission } from '../../../common/constants/permissions';
import { AuthUser } from '../../../common/types/auth-user.type';
import { TicketResponseDto } from '../contracts/responses/ticket-response.dto';
import { TicketsService } from '../application/tickets.service';

@Controller('tickets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get('mine')
  @Permissions(AppPermission.TICKET_READ_OWN)
  listMine(@CurrentUser() user: AuthUser): Promise<TicketResponseDto[]> {
    return this.ticketsService.listMine(user.id);
  }

  @Get(':ticketId')
  @Permissions(AppPermission.TICKET_READ_OWN)
  getOwned(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.getOwned(ticketId, user.id);
  }
}