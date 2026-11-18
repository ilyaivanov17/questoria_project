export interface ActiveQuestRun {
  id: string;
  title: string;
  status: 'IN_PROGRESS';
  completedLevels: number;
  score: number;
  lastActivityAt: string;
}

export function selectActiveRuns(
  runs: unknown,
  limit?: number,
): ActiveQuestRun[];
