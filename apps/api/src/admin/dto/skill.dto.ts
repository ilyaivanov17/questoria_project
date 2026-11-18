import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

const SKILL_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

export class CreateSkillDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @Length(2, 80)
  key!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(10, 1000)
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(SKILL_DIFFICULTIES)
  difficulty?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  prerequisiteIds?: string[];
}

export class UpdateSkillDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(10, 1000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(SKILL_DIFFICULTIES)
  difficulty?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  prerequisiteIds?: string[];
}
