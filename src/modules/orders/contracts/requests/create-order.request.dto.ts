import { IsIn, IsString, IsUUID, Matches } from 'class-validator';
import {
  SUPPORTED_CURRENCIES,
  SupportedCurrency,
} from '../../../../shared/constants/payment.constants';

export class CreateOrderRequestDto {
  @IsUUID()
  reservationId!: string;

  @IsString()
  @Matches(/^\d+$/, {
    message: 'totalAmountMinor must be a string integer in minor units',
  })
  totalAmountMinor!: string;

  @IsIn(SUPPORTED_CURRENCIES)
  currency!: SupportedCurrency;
}