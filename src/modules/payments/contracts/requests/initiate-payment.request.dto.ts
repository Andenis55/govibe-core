import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaymentProvider } from '@prisma/client';

export class InitiatePaymentRequestDto {
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @IsUUID()
  eventId!: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;
}