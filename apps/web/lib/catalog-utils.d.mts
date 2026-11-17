export type QuestDurationFilter = 'all' | 'quick' | 'standard' | 'long';

export declare function missionCountLabel(count: number): string;
export declare function matchesDuration(
  durationMin: number,
  duration: QuestDurationFilter,
): boolean;
