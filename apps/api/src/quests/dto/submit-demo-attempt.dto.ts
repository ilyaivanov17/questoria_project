import { IsObject } from 'class-validator';

export class SubmitDemoAttemptDto {
  @IsObject()
  answer!: Record<string, unknown>;
}
