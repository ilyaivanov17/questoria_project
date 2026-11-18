export interface PuzzleAttemptSnapshot {
  puzzleId: string;
  isCorrect: boolean;
}

export interface PuzzleAttemptLimit {
  id: string;
  maxAttempts: number;
}

export function isPuzzleResolved(
  puzzle: PuzzleAttemptLimit,
  attempts: readonly PuzzleAttemptSnapshot[],
): boolean {
  const puzzleAttempts = attempts.filter((attempt) => attempt.puzzleId === puzzle.id);
  return puzzleAttempts.some((attempt) => attempt.isCorrect)
    || puzzleAttempts.length >= puzzle.maxAttempts;
}

export function getNextAvailablePuzzle<T extends PuzzleAttemptLimit>(
  puzzles: readonly T[],
  attempts: readonly PuzzleAttemptSnapshot[],
): T | undefined {
  return puzzles.find((puzzle) => !isPuzzleResolved(puzzle, attempts));
}

export function getResolvedPuzzleIds<T extends PuzzleAttemptLimit>(
  puzzles: readonly T[],
  attempts: readonly PuzzleAttemptSnapshot[],
): Set<string> {
  return new Set(
    puzzles
      .filter((puzzle) => isPuzzleResolved(puzzle, attempts))
      .map((puzzle) => puzzle.id),
  );
}
