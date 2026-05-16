import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(256)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId!: string;
}