import {
  Allow,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).+$/, {
    message: 'password must include uppercase, lowercase, and number',
  })
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId!: string;

  @IsOptional()
  @Allow()
  role?: unknown;
}