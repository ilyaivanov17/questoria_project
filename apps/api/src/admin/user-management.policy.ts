export function isSelfManagement(actorUserId: string, targetUserId: string): boolean {
  return actorUserId === targetUserId;
}

export function wouldRemoveLastActiveSuperAdmin(
  targetRoles: string[],
  targetStatus: string,
  activeSuperAdminCount: number,
): boolean {
  return targetStatus === 'ACTIVE'
    && targetRoles.includes('SUPER_ADMIN')
    && activeSuperAdminCount <= 1;
}
