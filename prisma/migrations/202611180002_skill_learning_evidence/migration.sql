CREATE TYPE "SkillMasteryStatus" AS ENUM (
  'PRACTICING',
  'DEVELOPING',
  'PROFICIENT',
  'MASTERED'
);

CREATE TYPE "LearningEvidenceType" AS ENUM (
  'INITIAL',
  'PRACTICE',
  'DELAYED_CHECK',
  'TRANSFER'
);

CREATE TABLE "skills" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "difficulty" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "skill_prerequisites" (
  "skill_id" UUID NOT NULL,
  "prerequisite_id" UUID NOT NULL,
  CONSTRAINT "skill_prerequisites_pkey" PRIMARY KEY ("skill_id", "prerequisite_id"),
  CONSTRAINT "skill_prerequisites_no_self_reference" CHECK ("skill_id" <> "prerequisite_id")
);

CREATE TABLE "profile_skill_progress" (
  "id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "status" "SkillMasteryStatus" NOT NULL DEFAULT 'PRACTICING',
  "attempts_count" INTEGER NOT NULL DEFAULT 0,
  "successful_attempts" INTEGER NOT NULL DEFAULT 0,
  "distinct_puzzles" INTEGER NOT NULL DEFAULT 0,
  "distinct_quest_versions" INTEGER NOT NULL DEFAULT 0,
  "distinct_quests" INTEGER NOT NULL DEFAULT 0,
  "distinct_task_types" INTEGER NOT NULL DEFAULT 0,
  "first_practiced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_practiced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mastered_at" TIMESTAMP(3),
  CONSTRAINT "profile_skill_progress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "profile_skill_progress_counts_nonnegative" CHECK (
    "attempts_count" >= 0 AND "successful_attempts" >= 0
    AND "distinct_puzzles" >= 0 AND "distinct_quest_versions" >= 0
    AND "distinct_quests" >= 0 AND "distinct_task_types" >= 0
  ),
  CONSTRAINT "profile_skill_progress_success_not_above_attempts"
    CHECK ("successful_attempts" <= "attempts_count")
);

CREATE TABLE "learning_evidence" (
  "id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "quest_run_id" UUID NOT NULL,
  "quest_version_id" UUID NOT NULL,
  "puzzle_id" UUID NOT NULL,
  "puzzle_attempt_id" UUID NOT NULL,
  "is_correct" BOOLEAN NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "task_type" TEXT NOT NULL,
  "evidence_type" "LearningEvidenceType" NOT NULL DEFAULT 'INITIAL',
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "learning_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skills_key_key" ON "skills"("key");
CREATE INDEX "skills_name_idx" ON "skills"("name");
CREATE INDEX "skills_difficulty_idx" ON "skills"("difficulty");
CREATE INDEX "skill_prerequisites_prerequisite_id_idx"
  ON "skill_prerequisites"("prerequisite_id");
CREATE UNIQUE INDEX "profile_skill_progress_profile_id_skill_id_key"
  ON "profile_skill_progress"("profile_id", "skill_id");
CREATE INDEX "profile_skill_progress_profile_id_status_idx"
  ON "profile_skill_progress"("profile_id", "status");
CREATE UNIQUE INDEX "learning_evidence_puzzle_attempt_id_skill_id_key"
  ON "learning_evidence"("puzzle_attempt_id", "skill_id");
CREATE INDEX "learning_evidence_profile_id_skill_id_occurred_at_idx"
  ON "learning_evidence"("profile_id", "skill_id", "occurred_at");
CREATE INDEX "learning_evidence_skill_id_quest_version_id_idx"
  ON "learning_evidence"("skill_id", "quest_version_id");

ALTER TABLE "skill_prerequisites"
  ADD CONSTRAINT "skill_prerequisites_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "skill_prerequisites"
  ADD CONSTRAINT "skill_prerequisites_prerequisite_id_fkey"
  FOREIGN KEY ("prerequisite_id") REFERENCES "skills"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "profile_skill_progress"
  ADD CONSTRAINT "profile_skill_progress_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profile_skill_progress"
  ADD CONSTRAINT "profile_skill_progress_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "learning_evidence"
  ADD CONSTRAINT "learning_evidence_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_evidence"
  ADD CONSTRAINT "learning_evidence_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_evidence"
  ADD CONSTRAINT "learning_evidence_quest_run_id_fkey"
  FOREIGN KEY ("quest_run_id") REFERENCES "quest_runs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_evidence"
  ADD CONSTRAINT "learning_evidence_quest_version_id_fkey"
  FOREIGN KEY ("quest_version_id") REFERENCES "quest_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_evidence"
  ADD CONSTRAINT "learning_evidence_puzzle_id_fkey"
  FOREIGN KEY ("puzzle_id") REFERENCES "puzzles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_evidence"
  ADD CONSTRAINT "learning_evidence_puzzle_attempt_id_fkey"
  FOREIGN KEY ("puzzle_attempt_id") REFERENCES "puzzle_attempts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION normalize_skill_key(skill_name TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(btrim(skill_name)), '[[:space:]]+', '-', 'g')
$$;

-- Backfill the catalog from tags on currently published versions. New published
-- versions are handled by the trigger below.
INSERT INTO "skills" ("id", "key", "name")
SELECT
  gen_random_uuid(),
  normalize_skill_key(tag.skill_name),
  MIN(btrim(tag.skill_name))
FROM "quest_versions" qv
CROSS JOIN LATERAL unnest(qv."skills") AS tag(skill_name)
WHERE qv."status" = 'PUBLISHED'
  AND btrim(tag.skill_name) <> ''
GROUP BY normalize_skill_key(tag.skill_name)
ON CONFLICT ("key") DO NOTHING;

CREATE FUNCTION ensure_published_version_skills()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  tag_name TEXT;
BEGIN
  IF NEW."status" <> 'PUBLISHED' THEN
    RETURN NEW;
  END IF;

  FOREACH tag_name IN ARRAY NEW."skills" LOOP
    IF btrim(tag_name) = '' THEN
      CONTINUE;
    END IF;

    INSERT INTO "skills" ("id", "key", "name")
    VALUES (gen_random_uuid(), normalize_skill_key(tag_name), btrim(tag_name))
    ON CONFLICT ("key") DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "quest_versions_seed_skills_after_insert"
AFTER INSERT ON "quest_versions"
FOR EACH ROW
WHEN (NEW."status" = 'PUBLISHED')
EXECUTE FUNCTION ensure_published_version_skills();

CREATE TRIGGER "quest_versions_seed_skills_after_publish"
AFTER UPDATE OF "status" ON "quest_versions"
FOR EACH ROW
WHEN (OLD."status" IS DISTINCT FROM NEW."status" AND NEW."status" = 'PUBLISHED')
EXECUTE FUNCTION ensure_published_version_skills();

CREATE FUNCTION refresh_profile_skill_progress(
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
    COUNT(DISTINCT le."task_type") FILTER (WHERE le."is_correct")::INTEGER,
    MIN(le."occurred_at"),
    MAX(le."occurred_at"),
    MIN(le."occurred_at") FILTER (WHERE le."is_correct"),
    MAX(le."occurred_at") FILTER (WHERE le."is_correct")
  INTO
    attempts_total, successes_total, puzzles_total, versions_total,
    quests_total, task_types_total, first_practice, last_practice,
    first_success, last_success
  FROM "learning_evidence" le
  INNER JOIN "quest_versions" qv ON qv."id" = le."quest_version_id"
  WHERE le."profile_id" = target_profile_id
    AND le."skill_id" = target_skill_id;

  IF successes_total >= 5
     AND puzzles_total >= 3
     AND task_types_total >= 2
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
    "distinct_quest_versions", "distinct_quests", "distinct_task_types",
    "first_practiced_at", "last_practiced_at", "mastered_at"
  )
  VALUES (
    gen_random_uuid(), target_profile_id, target_skill_id, next_status,
    attempts_total, successes_total, puzzles_total,
    versions_total, quests_total, task_types_total,
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

CREATE FUNCTION record_puzzle_attempt_learning_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  version_skills TEXT[];
  current_quest_id UUID;
  current_task_type TEXT;
  tag_name TEXT;
  tag_key TEXT;
  current_skill_id UUID;
  next_evidence_type "LearningEvidenceType";
BEGIN
  SELECT qv."skills", qv."quest_id", p."type"
  INTO version_skills, current_quest_id, current_task_type
  FROM "quest_runs" qr
  INNER JOIN "quest_versions" qv ON qv."id" = qr."quest_version_id"
  INNER JOIN "puzzles" p ON p."id" = NEW."puzzle_id"
  WHERE qr."id" = NEW."quest_run_id"
    AND qr."profile_id" = NEW."profile_id";

  IF NOT FOUND OR COALESCE(array_length(version_skills, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;

  -- Serialize events for this profile so aggregate counters cannot lose
  -- concurrent evidence from separate runs.
  PERFORM 1 FROM "profiles" WHERE "id" = NEW."profile_id" FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  FOR tag_name IN
    SELECT DISTINCT btrim(value)
    FROM unnest(version_skills) AS value
    WHERE btrim(value) <> ''
  LOOP
    tag_key := normalize_skill_key(tag_name);

    INSERT INTO "skills" ("id", "key", "name")
    VALUES (gen_random_uuid(), tag_key, tag_name)
    ON CONFLICT ("key") DO NOTHING;

    SELECT "id" INTO current_skill_id
    FROM "skills"
    WHERE "key" = tag_key;

    IF EXISTS (
      SELECT 1
      FROM "learning_evidence" le
      INNER JOIN "quest_versions" previous_version
        ON previous_version."id" = le."quest_version_id"
      WHERE le."profile_id" = NEW."profile_id"
        AND le."skill_id" = current_skill_id
        AND previous_version."quest_id" <> current_quest_id
        AND (le."occurred_at" < NEW."created_at"
          OR (le."occurred_at" = NEW."created_at" AND le."puzzle_attempt_id" < NEW."id"))
    ) THEN
      next_evidence_type := 'TRANSFER';
    ELSIF EXISTS (
      SELECT 1
      FROM "learning_evidence" le
      WHERE le."profile_id" = NEW."profile_id"
        AND le."skill_id" = current_skill_id
        AND le."is_correct" = TRUE
        AND le."occurred_at" <= NEW."created_at" - INTERVAL '24 hours'
    ) THEN
      next_evidence_type := 'DELAYED_CHECK';
    ELSIF EXISTS (
      SELECT 1
      FROM "learning_evidence" le
      WHERE le."profile_id" = NEW."profile_id"
        AND le."skill_id" = current_skill_id
        AND (le."occurred_at" < NEW."created_at"
          OR (le."occurred_at" = NEW."created_at" AND le."puzzle_attempt_id" < NEW."id"))
    ) THEN
      next_evidence_type := 'PRACTICE';
    ELSE
      next_evidence_type := 'INITIAL';
    END IF;

    INSERT INTO "learning_evidence" (
      "id", "profile_id", "skill_id", "quest_run_id", "quest_version_id",
      "puzzle_id", "puzzle_attempt_id", "is_correct", "score",
      "task_type", "evidence_type", "occurred_at"
    )
    VALUES (
      gen_random_uuid(), NEW."profile_id", current_skill_id,
      NEW."quest_run_id",
      (SELECT "quest_version_id" FROM "quest_runs" WHERE "id" = NEW."quest_run_id"),
      NEW."puzzle_id", NEW."id", NEW."is_correct", NEW."score",
      current_task_type, next_evidence_type, NEW."created_at"
    )
    ON CONFLICT ("puzzle_attempt_id", "skill_id") DO NOTHING;

    IF FOUND THEN
      PERFORM refresh_profile_skill_progress(NEW."profile_id", current_skill_id);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Existing attempts are migrated into evidence. A different root quest counts
-- as transfer; a successful attempt at least 24 hours later is delayed review.
WITH expanded AS (
  SELECT
    pa."id" AS attempt_id,
    pa."profile_id",
    pa."quest_run_id",
    qr."quest_version_id",
    qv."quest_id",
    p."id" AS puzzle_id,
    p."type" AS task_type,
    pa."is_correct",
    pa."score",
    pa."created_at",
    normalize_skill_key(btrim(tag.skill_name)) AS skill_key
  FROM "puzzle_attempts" pa
  INNER JOIN "quest_runs" qr ON qr."id" = pa."quest_run_id"
  INNER JOIN "quest_versions" qv ON qv."id" = qr."quest_version_id"
  INNER JOIN "puzzles" p ON p."id" = pa."puzzle_id"
  CROSS JOIN LATERAL unnest(qv."skills") AS tag(skill_name)
  WHERE qv."status" = 'PUBLISHED'
    AND btrim(tag.skill_name) <> ''
),
classified AS (
  SELECT
    current.*,
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM expanded previous
        WHERE previous."profile_id" = current."profile_id"
          AND previous."skill_key" = current."skill_key"
          AND (previous."created_at" < current."created_at"
            OR (previous."created_at" = current."created_at" AND previous."attempt_id" < current."attempt_id"))
      ) THEN 'INITIAL'::"LearningEvidenceType"
      WHEN EXISTS (
        SELECT 1 FROM expanded previous
        WHERE previous."profile_id" = current."profile_id"
          AND previous."skill_key" = current."skill_key"
          AND previous."quest_id" <> current."quest_id"
          AND (previous."created_at" < current."created_at"
            OR (previous."created_at" = current."created_at" AND previous."attempt_id" < current."attempt_id"))
      ) THEN 'TRANSFER'::"LearningEvidenceType"
      WHEN EXISTS (
        SELECT 1 FROM expanded previous
        WHERE previous."profile_id" = current."profile_id"
          AND previous."skill_key" = current."skill_key"
          AND previous."is_correct" = TRUE
          AND previous."created_at" <= current."created_at" - INTERVAL '24 hours'
      ) THEN 'DELAYED_CHECK'::"LearningEvidenceType"
      ELSE 'PRACTICE'::"LearningEvidenceType"
    END AS evidence_type
  FROM expanded current
)
INSERT INTO "learning_evidence" (
  "id", "profile_id", "skill_id", "quest_run_id", "quest_version_id",
  "puzzle_id", "puzzle_attempt_id", "is_correct", "score",
  "task_type", "evidence_type", "occurred_at"
)
SELECT
  gen_random_uuid(), c."profile_id", s."id", c."quest_run_id", c."quest_version_id",
  c."puzzle_id", c."attempt_id", c."is_correct", c."score",
  c."task_type", c."evidence_type", c."created_at"
FROM classified c
INNER JOIN "skills" s ON s."key" = c."skill_key"
ON CONFLICT ("puzzle_attempt_id", "skill_id") DO NOTHING;

CREATE FUNCTION prevent_learning_evidence_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'learning_evidence is append-only; corrections require a separate audited event';
END;
$$;

CREATE TRIGGER "learning_evidence_no_update_or_delete"
BEFORE UPDATE OR DELETE ON "learning_evidence"
FOR EACH ROW EXECUTE FUNCTION prevent_learning_evidence_mutation();

CREATE TRIGGER "puzzle_attempts_record_learning_evidence"
AFTER INSERT ON "puzzle_attempts"
FOR EACH ROW
EXECUTE FUNCTION record_puzzle_attempt_learning_evidence();

-- Rebuild the aggregate table from both historical and newly-recorded evidence.
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
