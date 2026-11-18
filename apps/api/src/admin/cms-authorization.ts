export interface CmsActor {
  userId: string;
  roleKeys: readonly string[];
}

const CONTENT_REVIEW_ROLES = new Set(['REVIEWER', 'ADMIN', 'SUPER_ADMIN']);
const CONTENT_ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

export function canViewAllQuestVersions(actor: CmsActor): boolean {
  return actor.roleKeys.some((role) => CONTENT_REVIEW_ROLES.has(role));
}

export function canManageQuestDraft(actor: CmsActor, authorId: string | null): boolean {
  return authorId === actor.userId
    || actor.roleKeys.some((role) => CONTENT_ADMIN_ROLES.has(role));
}
