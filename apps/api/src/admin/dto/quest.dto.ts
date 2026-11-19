import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const PUZZLE_TYPES = ['single_choice', 'multiple_choice', 'numeric_input', 'text_input', 'ordering'];

export class PuzzleInputDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  orderNo!: number;

  @IsString()
  @IsIn(PUZZLE_TYPES)
  type!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  maxScore!: number;

  @IsObject()
  publicPayload!: Record<string, unknown>;

  @IsObject()
  solutionPrivate!: Record<string, unknown>;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  hints!: string[];
}

export class LevelInputDto {
  @IsInt()
  @Min(1)
  @Max(100)
  orderNo!: number;

  @IsString()
  @Length(2, 160)
  title!: string;

  @IsString()
  @Length(5, 3000)
  intro!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PuzzleInputDto)
  puzzles!: PuzzleInputDto[];
}

export class CreateQuestDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @Length(3, 100)
  slug!: string;

  @IsString()
  @IsIn(['ru', 'de', 'en'])
  locale!: string;

  @IsOptional()
  @IsString()
  @Length(2, 140)
  internalName?: string;

  @IsString()
  @Length(5, 160)
  title!: string;

  @IsString()
  @Length(20, 500)
  summary!: string;

  @IsString()
  @Length(50, 12000)
  description!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  objectives!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(2, 120, { each: true })
  skills!: string[];

  @IsInt()
  @Min(14)
  @Max(99)
  ageMin!: number;

  @IsInt()
  @Min(14)
  @Max(99)
  ageMax!: number;

  @IsString()
  @IsIn(['beginner', 'intermediate', 'advanced'])
  difficulty!: string;

  @IsInt()
  @Min(1)
  @Max(240)
  durationMin!: number;

  @IsObject()
  seo!: Record<string, unknown>;

  @IsString()
  @Length(8, 2048)
  coverUrl!: string;

  @IsString()
  @Length(5, 300)
  coverAlt!: string;

  @IsString()
  @Length(5, 500)
  coverLicenseSource!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LevelInputDto)
  levels!: LevelInputDto[];
}

export class UpdateQuestDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @Length(3, 100)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(2, 140)
  internalName?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ru', 'de', 'en'])
  locale?: string;

  @IsOptional()
  @IsString()
  @Length(5, 160)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(20, 500)
  summary?: string;

  @IsOptional()
  @IsString()
  @Length(50, 12000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  objectives?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(2, 120, { each: true })
  skills?: string[];

  @IsOptional()
  @IsInt()
  @Min(14)
  @Max(99)
  ageMin?: number;

  @IsOptional()
  @IsInt()
  @Min(14)
  @Max(99)
  ageMax?: number;

  @IsOptional()
  @IsString()
  @IsIn(['beginner', 'intermediate', 'advanced'])
  difficulty?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  durationMin?: number;

  @IsOptional()
  @IsObject()
  seo?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @Length(8, 2048)
  coverUrl?: string;

  @IsOptional()
  @IsString()
  @Length(5, 300)
  coverAlt?: string;

  @IsOptional()
  @IsString()
  @Length(5, 500)
  coverLicenseSource?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LevelInputDto)
  levels?: LevelInputDto[];
}

export class RequestQuestChangesDto {
  @IsString()
  @Length(10, 2000)
  feedback!: string;
}

export class AssignQuestReviewerDto {
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  reviewerId!: string | null;
}
