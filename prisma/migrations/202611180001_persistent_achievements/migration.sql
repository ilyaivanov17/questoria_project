CREATE TABLE "achievements" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "xp_reward" INTEGER NOT NULL DEFAULT 0,
  "coins_reward" INTEGER NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "achievements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "achievements_xp_reward_nonnegative" CHECK ("xp_reward" >= 0),
  CONSTRAINT "achievements_coins_reward_nonnegative" CHECK ("coins_reward" >= 0)
);

CREATE TABLE "profile_achievements" (
  "id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "achievement_id" UUID NOT NULL,
  "xp_awarded" INTEGER NOT NULL DEFAULT 0,
  "coins_awarded" INTEGER NOT NULL DEFAULT 0,
  "awarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profile_achievements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "profile_achievements_xp_nonnegative" CHECK ("xp_awarded" >= 0),
  CONSTRAINT "profile_achievements_coins_nonnegative" CHECK ("coins_awarded" >= 0)
);

CREATE UNIQUE INDEX "achievements_code_key" ON "achievements"("code");
CREATE INDEX "achievements_active_sort_order_idx" ON "achievements"("active", "sort_order");
CREATE UNIQUE INDEX "profile_achievements_profile_id_achievement_id_key"
  ON "profile_achievements"("profile_id", "achievement_id");
CREATE INDEX "profile_achievements_profile_id_awarded_at_idx"
  ON "profile_achievements"("profile_id", "awarded_at");

ALTER TABLE "profile_achievements"
  ADD CONSTRAINT "profile_achievements_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profile_achievements"
  ADD CONSTRAINT "profile_achievements_achievement_id_fkey"
  FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "achievements"
  ("id", "code", "title", "description", "icon", "xp_reward", "coins_reward", "sort_order", "active", "updated_at")
VALUES
  ('00000000-0000-4000-8000-000000000001', 'first-quest', 'Первое открытие', 'Заверши свой первый квест', '✦', 10, 0, 1, TRUE, NOW()),
  ('00000000-0000-4000-8000-000000000002', 'three-quests', 'Следопыт', 'Заверши три разных квеста', '⌖', 25, 0, 2, TRUE, NOW()),
  ('00000000-0000-4000-8000-000000000003', 'five-levels', 'Покоритель этапов', 'Пройди пять разных игровых этапов', '◇', 20, 0, 3, TRUE, NOW()),
  ('00000000-0000-4000-8000-000000000004', 'hundred-xp', 'Сотня опыта', 'Накопи 100 XP', '⚡', 10, 0, 4, TRUE, NOW()),
  ('00000000-0000-4000-8000-000000000005', 'ten-runs', 'Упорство', 'Заверши десять прохождений', '★', 25, 0, 5, TRUE, NOW());

CREATE OR REPLACE FUNCTION grant_profile_achievements(target_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  completed_quest_count INTEGER;
  completed_run_count INTEGER;
  unique_level_count INTEGER;
  xp_total INTEGER;
  candidate RECORD;
  eligible BOOLEAN;
  awarded_id UUID;
BEGIN
  -- Serialize eligibility checks for one profile. Concurrent game events for
  -- this player see each other's committed progress before evaluating thresholds.
  PERFORM 1 FROM "profiles" WHERE "id" = target_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::INTEGER
    INTO completed_quest_count
    FROM "quest_completions"
    WHERE "profile_id" = target_profile_id;

  SELECT COUNT(*)::INTEGER
    INTO completed_run_count
    FROM "quest_runs"
    WHERE "profile_id" = target_profile_id
      AND "status" = 'COMPLETED';

  SELECT COUNT(DISTINCT lp."level_id")::INTEGER
    INTO unique_level_count
    FROM "level_progress" lp
    INNER JOIN "quest_runs" qr ON qr."id" = lp."quest_run_id"
    WHERE qr."profile_id" = target_profile_id
      AND lp."status" = 'COMPLETED';

  SELECT COALESCE(SUM("amount"), 0)::INTEGER
    INTO xp_total
    FROM "wallet_ledger"
    WHERE "profile_id" = target_profile_id
      AND "currency" = 'XP';

  FOR candidate IN
    SELECT * FROM "achievements"
    WHERE "active" = TRUE
    ORDER BY "sort_order", "code"
  LOOP
    eligible := CASE candidate."code"
      WHEN 'first-quest' THEN completed_quest_count >= 1
      WHEN 'three-quests' THEN completed_quest_count >= 3
      WHEN 'five-levels' THEN unique_level_count >= 5
      WHEN 'hundred-xp' THEN xp_total >= 100
      WHEN 'ten-runs' THEN completed_run_count >= 10
      ELSE FALSE
    END;

    IF NOT eligible THEN
      CONTINUE;
    END IF;

    awarded_id := NULL;
    INSERT INTO "profile_achievements"
      ("id", "profile_id", "achievement_id", "xp_awarded", "coins_awarded", "awarded_at")
    VALUES
      (gen_random_uuid(), target_profile_id, candidate."id",
       candidate."xp_reward", candidate."coins_reward", NOW())
    ON CONFLICT ("profile_id", "achievement_id") DO NOTHING
    RETURNING "id" INTO awarded_id;

    IF awarded_id IS NULL THEN
      CONTINUE;
    END IF;

    IF candidate."xp_reward" > 0 THEN
      INSERT INTO "wallet_ledger"
        ("id", "profile_id", "currency", "amount", "reason", "source_type", "source_id", "idempotency_key")
      VALUES
        (gen_random_uuid(), target_profile_id, 'XP', candidate."xp_reward",
         'Достижение: ' || candidate."title", 'ACHIEVEMENT', candidate."id"::TEXT,
         'achievement:' || target_profile_id::TEXT || ':' || candidate."code" || ':XP')
      ON CONFLICT ("idempotency_key") DO NOTHING;

      IF FOUND THEN
        xp_total := xp_total + candidate."xp_reward";
      END IF;
    END IF;

    IF candidate."coins_reward" > 0 THEN
      INSERT INTO "wallet_ledger"
        ("id", "profile_id", "currency", "amount", "reason", "source_type", "source_id", "idempotency_key")
      VALUES
        (gen_random_uuid(), target_profile_id, 'COIN', candidate."coins_reward",
         'Достижение: ' || candidate."title", 'ACHIEVEMENT', candidate."id"::TEXT,
         'achievement:' || target_profile_id::TEXT || ':' || candidate."code" || ':COIN')
      ON CONFLICT ("idempotency_key") DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION evaluate_profile_achievements_from_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_profile_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'level_progress' THEN
    SELECT "profile_id" INTO target_profile_id
      FROM "quest_runs"
      WHERE "id" = NEW."quest_run_id";
  ELSE
    target_profile_id := NEW."profile_id";
  END IF;

  PERFORM grant_profile_achievements(target_profile_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "level_progress_grant_achievements"
AFTER INSERT ON "level_progress"
FOR EACH ROW
WHEN (NEW."status" = 'COMPLETED')
EXECUTE FUNCTION evaluate_profile_achievements_from_event();

CREATE TRIGGER "quest_completions_grant_achievements"
AFTER INSERT ON "quest_completions"
FOR EACH ROW
EXECUTE FUNCTION evaluate_profile_achievements_from_event();

CREATE TRIGGER "quest_runs_grant_achievements"
AFTER UPDATE OF "status" ON "quest_runs"
FOR EACH ROW
WHEN (OLD."status" IS DISTINCT FROM NEW."status" AND NEW."status" = 'COMPLETED')
EXECUTE FUNCTION evaluate_profile_achievements_from_event();

CREATE TRIGGER "wallet_ledger_grant_achievements"
AFTER INSERT ON "wallet_ledger"
FOR EACH ROW
WHEN (NEW."currency" = 'XP' AND NEW."amount" > 0)
EXECUTE FUNCTION evaluate_profile_achievements_from_event();

CREATE OR REPLACE FUNCTION prevent_profile_achievement_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'profile_achievements is immutable; achievements are permanent unlock records';
END;
$$;

CREATE TRIGGER "profile_achievements_no_update_or_delete"
BEFORE UPDATE OR DELETE ON "profile_achievements"
FOR EACH ROW EXECUTE FUNCTION prevent_profile_achievement_mutation();

-- Backfill existing profiles transactionally so release does not reset progress.
DO $$
DECLARE
  profile_row RECORD;
BEGIN
  FOR profile_row IN SELECT "id" FROM "profiles" LOOP
    PERFORM grant_profile_achievements(profile_row."id");
  END LOOP;
END;
$$;
