export type ReviewState = 'due' | 'upcoming';
export type SkillStatus = 'not_started' | 'practicing' | 'developing' | 'proficient' | 'mastered';
export type EvidenceKind = 'initial' | 'practice' | 'delayed_check' | 'transfer';

export function pluralizeRussianDays(value: number): string;
export function getReviewTimingLabel(state: ReviewState, daysOverdue: number): string;
export function getSkillStatusLabel(status: SkillStatus): string;
export function getEvidenceTypeLabel(kind: EvidenceKind): string;
