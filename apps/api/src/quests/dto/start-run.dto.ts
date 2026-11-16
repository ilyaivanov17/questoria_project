import { IsString, Length } from 'class-validator';

export class StartRunDto {
  @IsString()
  @Length(1, 120)
  slug!: string;
}
