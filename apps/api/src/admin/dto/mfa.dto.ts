import { IsString, Matches } from 'class-validator';

export class VerifyMfaDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}


export class UseMfaRecoveryCodeDto {
  @IsString()
  @Length(24, 30)
  @Matches(/^[A-Fa-f0-9\s-]+$/)
  code!: string;
}
