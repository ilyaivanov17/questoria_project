import { IsString, Matches } from 'class-validator';

export class VerifyMfaDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
