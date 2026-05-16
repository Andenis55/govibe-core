import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class HoldTableDto {
  @IsUUID()
  eventTableId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  holdDurationSeconds?: number;
}