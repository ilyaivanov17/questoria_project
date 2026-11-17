import { IsIn, IsString, Length } from 'class-validator';

const ROLE_KEYS = ['AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN'] as const;

export class AssignUserRoleDto {
  @IsIn(ROLE_KEYS)
  role!: (typeof ROLE_KEYS)[number];

  @IsString()
  @Length(5, 300)
  reason!: string;
}

export class RemoveUserRoleDto {
  @IsString()
  @Length(5, 300)
  reason!: string;
}

export class UpdateManagedUserStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status!: 'ACTIVE' | 'SUSPENDED';

  @IsString()
  @Length(5, 300)
  reason!: string;
}
