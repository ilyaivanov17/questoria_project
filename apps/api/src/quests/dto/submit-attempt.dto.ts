import { IsObject, IsUUID } from 'class-validator';

export class SubmitAttemptDto {
  @IsUUID()
  attemptId!: string;

  @IsObject()
  answer!: Record<string, unknown>;
}
