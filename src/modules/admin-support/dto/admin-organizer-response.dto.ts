import { OrganizerStatus } from '@prisma/client';

export class AdminOrganizerResponseDto {
  id!: string;
  ownerUserId!: string;
  displayName!: string;
  slug!: string;
  status!: OrganizerStatus;
  contactEmail!: string | null;
  contactPhone!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}
