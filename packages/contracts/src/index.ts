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

export type PlayerSkillStatus =
  | 'not_started'
  | 'practicing'
  | 'developing'
  | 'proficient'
  | 'mastered';

export type LearningEvidenceKind =
  | 'initial'
  | 'practice'
  | 'delayed_check'
  | 'transfer';

export interface PlayerSkillPrerequisite {
  id: string;
  key: string;
  name: string;
  status: PlayerSkillStatus;
  mastered: boolean;
}

export interface PlayerSkillProgress {
  id: string;
  key: string;
  name: string;
  description: string | null;
  difficulty: string | null;
  status: PlayerSkillStatus;
  available: boolean;
  prerequisites: PlayerSkillPrerequisite[];
  attemptsCount: number;
  successfulAttempts: number;
  distinctPuzzles: number;
  distinctQuestVersions: number;
  distinctQuests: number;
  distinctTaskTypes: number;
  firstPracticedAt: string | null;
  lastPracticedAt: string | null;
  masteredAt: string | null;
}

export interface PlayerLearningEvidence {
  id: string;
  skillKey: string;
  skillName: string;
  taskType: string;
  evidenceType: LearningEvidenceKind;
  isCorrect: boolean;
  score: number;
  occurredAt: string;
  questTitle: string;
  questSlug: string;
  levelTitle: string;
  puzzleOrder: number;
}

export interface PlayerSkillsResponse {
  skills: PlayerSkillProgress[];
  recentEvidence: PlayerLearningEvidence[];
  summary: {
    totalSkills: number;
    practicedSkills: number;
    masteredSkills: number;
  };
}


export interface AdminSkillCatalogItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  difficulty: string | null;
  prerequisites: Array<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    difficulty: string | null;
  }>;
  unlocks: Array<{
    id: string;
    key: string;
    name: string;
  }>;
  evidenceCount: number;
  learnerCount: number;
  createdAt: string;
}

export interface CreateSkillRequest {
  key: string;
  name: string;
  description?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  prerequisiteIds?: string[];
}

export interface UpdateSkillRequest {
  name?: string;
  description?: string | null;
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | null;
  prerequisiteIds?: string[];
}
