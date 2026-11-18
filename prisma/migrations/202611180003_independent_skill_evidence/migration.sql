-- Require evidence from more than one independent play session before
-- granting new MASTERED status. Historical MASTERED records remain immutable.
ALTER TABLE "profile_skill_progress"
  ADD COLUMN "distinct_runs" INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION refresh_profile_skill_progress(
  target_profile_id UUID,
  target_skill_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  attempts_total INTEGER;
  successes_total INTEGER;
  puzzles_total INTEGER;
  versions_total INTEGER;
  quests_total INTEGER;
  runs_total INTEGER;
  task_types_total INTEGER;
  first_practice TIMESTAMP(3);
  last_practice TIMESTAMP(3);
  first_success TIMESTAMP(3);
  last_success TIMESTAMP(3);
  next_status "SkillMasteryStatus";
BEGIN
  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE le."is_correct")::INTEGER,
    COUNT(DISTINCT le."puzzle_id") FILTER (WHERE le."is_correct")::INTEGER,
    COUNT(DISTINCT le."quest_version_id") FILTER (WHERE le."is_correct")::INTEGER,
    COUNT(DISTINCT qv."quest_id") FILTER (WHERE le."is_correct")::INTEGER,
    COUNT(DISTINCT le."quest_run_id") FILTER (WHERE le."is_correct")::INTEGER,
    COUNT(DISTINCT le."task_type") FILTER (WHERE le."is_correct")::INTEGER,
    MIN(le."occurred_at"),
    MAX(le."occurred_at"),
    MIN(le."occurred_at") FILTER (WHERE le."is_correct"),
    MAX(le."occurred_at") FILTER (WHERE le."is_correct")
  INTO
    attempts_total, successes_total, puzzles_total, versions_total,
    quests_total, runs_total, task_types_total, first_practice, last_practice,
    first_success, last_success
  FROM "learning_evidence" le
  INNER JOIN "quest_versions" qv ON qv."id" = le."quest_version_id"
  WHERE le."profile_id" = target_profile_id
    AND le."skill_id" = target_skill_id;

  IF successes_total >= 5
     AND puzzles_total >= 3
     AND task_types_total >= 2
     AND runs_total >= 2
     AND (quests_total >= 2 OR last_success >= first_success + INTERVAL '24 hours') THEN
    next_status := 'MASTERED';
  ELSIF successes_total >= 4
     AND puzzles_total >= 3
     AND task_types_total >= 2 THEN
    next_status := 'PROFICIENT';
  ELSIF successes_total >= 2
     AND puzzles_total >= 2 THEN
    next_status := 'DEVELOPING';
  ELSE
    next_status := 'PRACTICING';
  END IF;

  INSERT INTO "profile_skill_progress" (
    "id", "profile_id", "skill_id", "status",
    "attempts_count", "successful_attempts", "distinct_puzzles",
    "distinct_quest_versions", "distinct_quests", "distinct_runs",
    "distinct_task_types", "first_practiced_at", "last_practiced_at", "mastered_at"
  )
  VALUES (
    gen_random_uuid(), target_profile_id, target_skill_id, next_status,
    attempts_total, successes_total, puzzles_total,
    versions_total, quests_total, runs_total, task_types_total,
    first_practice, last_practice,
    CASE WHEN next_status = 'MASTERED' THEN last_success ELSE NULL END
  )
  ON CONFLICT ("profile_id", "skill_id") DO UPDATE SET
    "status" = CASE
      WHEN "profile_skill_progress"."status" = 'MASTERED' THEN 'MASTERED'::"SkillMasteryStatus"
      ELSE EXCLUDED."status"
    END,
    "attempts_count" = EXCLUDED."attempts_count",
    "successful_attempts" = EXCLUDED."successful_attempts",
    "distinct_puzzles" = EXCLUDED."distinct_puzzles",
    "distinct_quest_versions" = EXCLUDED."distinct_quest_versions",
    "distinct_quests" = EXCLUDED."distinct_quests",
    "distinct_runs" = EXCLUDED."distinct_runs",
    "distinct_task_types" = EXCLUDED."distinct_task_types",
    "first_practiced_at" = EXCLUDED."first_practiced_at",
    "last_practiced_at" = EXCLUDED."last_practiced_at",
    "mastered_at" = CASE
      WHEN "profile_skill_progress"."status" = 'MASTERED'
        THEN "profile_skill_progress"."mastered_at"
      WHEN EXCLUDED."status" = 'MASTERED'
        THEN EXCLUDED."mastered_at"
      ELSE NULL
    END;
END;
$$;

-- Refresh projections so the new independent-run count is populated for
-- historical evidence as well as evidence recorded after this migration.
DO $$
DECLARE
  evidence_profile RECORD;
BEGIN
  FOR evidence_profile IN
    SELECT DISTINCT "profile_id", "skill_id" FROM "learning_evidence"
  LOOP
    PERFORM refresh_profile_skill_progress(evidence_profile."profile_id", evidence_profile."skill_id");
  END LOOP;
END;
$$;
