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
  distinctRuns: number;
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


export interface AdminLearningAnalytics {
  generatedAt: string;
  totals: {
    skills: number;
    evidence: number;
    successfulEvidence: number;
    learners: number;
    masteredLearners: number;
    successRate: number | null;
    masteryRate: number | null;
  };
  skills: Array<{
    skillId: string;
    skillKey: string;
    skillName: string;
    evidence: {
      attempts: number;
      successful: number;
      successRate: number | null;
      evidenceTypeCount: number;
      taskTypes: Array<{
        taskType: string;
        attempts: number;
        successful: number;
        successRate: number;
      }>;
    };
    learners: number;
    mastery: {
      mastered: number;
      proficient: number;
      developing: number;
      practicing: number;
      masteryRate: number | null;
    };
    qualitySignals: Array<'LOW_SAMPLE_SIZE' | 'LOW_SUCCESS_RATE' | 'LOW_TASK_DIVERSITY'>;
  }>;
}


export interface AdminTaskLearningAnalytics {
  generatedAt: string;
  totals: {
    puzzleSkillPairs: number;
    attempts: number;
    learners: number;
    flagged: number;
  };
  tasks: Array<{
    puzzleId: string;
    puzzleOrder: number | null;
    puzzleType: string | null;
    levelOrder: number | null;
    levelTitle: string | null;
    questVersionId: string | null;
    questVersion: number | null;
    questTitle: string | null;
    questSlug: string | null;
    skillId: string;
    skillKey: string | null;
    skillName: string | null;
    attempts: number;
    successful: number;
    successRate: number | null;
    learners: number;
    evidenceTypeCount: number;
    masteryDiscrimination: {
      mastered: { attempts: number; learners: number; successRate: number | null };
      notMastered: { attempts: number; learners: number; successRate: number | null };
      successRateGap: number | null;
    };
    qualitySignals: Array<'LOW_SAMPLE_SIZE' | 'LOW_SUCCESS_RATE' | 'LOW_MASTERY_SEPARATION' | 'LOW_EVIDENCE_DIVERSITY'>;
  }>;
  notes: {
    masteryCohorts: string;
    lowMasterySeparation: string;
  };
}

