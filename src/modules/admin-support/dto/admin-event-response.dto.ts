import { EventCategory, EventStatus, EventVisibility } from '@prisma/client';

export class AdminEventResponseDto {
  id!: string;
  organizerId!: string;
  title!: string;
  slug!: string;
  status!: EventStatus;
  visibility!: EventVisibility;
  category!: EventCategory;
  startsAt!: Date;
  endsAt!: Date;
  venueName!: string | null;
  city!: string | null;
  country!: string;
  paymentEnabled!: boolean;
  priceMinor!: number | null;
  priceCurrency!: string;
  publishedAt!: Date | null;
  cancelledAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}
