import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { AppPermission } from '../../../common/constants/permissions';
import { AuthUser } from '../../../common/types/auth-user.type';
import { AdmissionsService } from '../application/admissions.service';
import { ScanTicketDto } from '../contracts/requests/scan-ticket.dto';
import { AdmissionScanResponseDto } from '../contracts/responses/admission-scan-response.dto';

@Controller('admissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdmissionsController {
  constructor(private readonly admissionsService: AdmissionsService) {}

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @Permissions(AppPermission.ADMISSION_SCAN_EVENT)
  scanTicket(
    @Body() body: ScanTicketDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdmissionScanResponseDto> {
    return this.admissionsService.scanTicket({
      ticketId: body.ticketId,
      token: body.token,
      scannedByUserId: user.id,
      eventId: body.eventId ?? null,
      deviceId: body.deviceId ?? null,
      gateLabel: body.gateLabel ?? null,
    });
  }
}