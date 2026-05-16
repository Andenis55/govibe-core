import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AppPermission } from '../../../common/constants/permissions';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { OrganizersService } from '../application/organizers.service';
import { CreateOrganizerRequestDto } from '../contracts/requests/create-organizer.request.dto';
import { SubmitOrganizerRequestDto } from '../contracts/requests/submit-organizer.request.dto';
import { UpdateOrganizerRequestDto } from '../contracts/requests/update-organizer.request.dto';

@Controller('organizers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrganizersController {
  constructor(private readonly organizers: OrganizersService) {}

  @Post()
  @Permissions(AppPermission.ORGANIZER_CREATE)
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateOrganizerRequestDto,
  ) {
    return this.organizers.create(user.id, dto);
  }

  @Get('mine')
  @Permissions(AppPermission.ORGANIZER_READ_OWN)
  listMine(@CurrentUser() user: { id: string }) {
    return this.organizers.listMine(user.id);
  }

  @Get(':organizerId')
  @Permissions(AppPermission.ORGANIZER_READ_OWN)
  getMine(
    @CurrentUser() user: { id: string },
    @Param('organizerId', ParseUUIDPipe) organizerId: string,
  ) {
    return this.organizers.getOwned(organizerId, user.id);
  }

  @Patch(':organizerId')
  @Permissions(AppPermission.ORGANIZER_UPDATE_OWN)
  updateMine(
    @CurrentUser() user: { id: string },
    @Param('organizerId', ParseUUIDPipe) organizerId: string,
    @Body() dto: UpdateOrganizerRequestDto,
  ) {
    return this.organizers.updateOwned(organizerId, user.id, dto);
  }

  @Post(':organizerId/submit')
  @Permissions(AppPermission.ORGANIZER_SUBMIT_OWN)
  submitForReview(
    @CurrentUser() user: { id: string },
    @Param('organizerId', ParseUUIDPipe) organizerId: string,
    @Body() dto: SubmitOrganizerRequestDto,
  ) {
    return this.organizers.submitForReview(organizerId, user.id, dto);
  }
}