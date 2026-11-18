export interface HealthResponse {
  status: 'ok';
  service: 'questoria-api';
  timestamp: string;
}

export interface HealthReadinessResponse {
  status: 'ready';
  service: 'questoria-api';
  timestamp: string;
  checks: {
    database: 'ok';
  };
}

export interface PuzzleAnswerReview {
  explanation: string;
  /** Answer shape matches the answer field for the puzzle type. */
  correctAnswer: Record<string, unknown>;
  /** Human-readable answer text mapped from the public option/item labels. */
  correctAnswerText: string;
}

export interface PuzzleAttemptResponse {
  attemptId: string;
  result: 'correct' | 'incorrect';
  scoreAwarded: number;
  attemptsRemaining: number;
  feedback: string;
  rewards: {
    xp: number;
    coins: number;
    firstCompletion: boolean;
  };
  runCompleted: boolean;
  puzzleProgress: {
    /** True when solved correctly or moved to review after exhausting attempts. */
    completed: boolean;
    correct: boolean;
    levelScore: number;
  };
  /** Present only after an incorrect final attempt for this puzzle. */
  review?: PuzzleAnswerReview;
}

export interface RunPuzzleReview extends PuzzleAnswerReview {
  puzzleId: string;
  prompt: string;
}
