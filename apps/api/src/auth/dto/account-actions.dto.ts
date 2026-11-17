import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class EmailAddressDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class VerifyEmailDto {
  @IsString()
  @Length(43, 128)
  token!: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(43, 128)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
