CREATE TYPE "LevelProgressStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "WalletCurrency" AS ENUM ('XP', 'COIN');

CREATE TABLE "level_progress" (
  "id" UUID NOT NULL,
  "quest_run_id" UUID NOT NULL,
  "level_id" UUID NOT NULL,
  "status" "LevelProgressStatus" NOT NULL DEFAULT 'COMPLETED',
  "score" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "level_progress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quest_completions" (
  "id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "quest_version_id" UUID NOT NULL,
  "quest_run_id" UUID NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "xp_awarded" INTEGER NOT NULL DEFAULT 0,
  "coins_awarded" INTEGER NOT NULL DEFAULT 0,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quest_completions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_ledger" (
  "id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "currency" "WalletCurrency" NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_ledger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_ledger_amount_nonzero" CHECK ("amount" <> 0)
);

CREATE UNIQUE INDEX "level_progress_quest_run_id_level_id_key"
  ON "level_progress"("quest_run_id", "level_id");
CREATE INDEX "level_progress_level_id_status_idx"
  ON "level_progress"("level_id", "status");
CREATE UNIQUE INDEX "quest_completions_quest_run_id_key"
  ON "quest_completions"("quest_run_id");
CREATE UNIQUE INDEX "quest_completions_profile_id_quest_version_id_key"
  ON "quest_completions"("profile_id", "quest_version_id");
CREATE INDEX "quest_completions_profile_id_completed_at_idx"
  ON "quest_completions"("profile_id", "completed_at");
CREATE UNIQUE INDEX "wallet_ledger_idempotency_key_key"
  ON "wallet_ledger"("idempotency_key");
CREATE INDEX "wallet_ledger_profile_id_created_at_idx"
  ON "wallet_ledger"("profile_id", "created_at");
CREATE INDEX "wallet_ledger_source_type_source_id_idx"
  ON "wallet_ledger"("source_type", "source_id");

ALTER TABLE "level_progress" ADD CONSTRAINT "level_progress_quest_run_id_fkey"
  FOREIGN KEY ("quest_run_id") REFERENCES "quest_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "level_progress" ADD CONSTRAINT "level_progress_level_id_fkey"
  FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quest_completions" ADD CONSTRAINT "quest_completions_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quest_completions" ADD CONSTRAINT "quest_completions_quest_version_id_fkey"
  FOREIGN KEY ("quest_version_id") REFERENCES "quest_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quest_completions" ADD CONSTRAINT "quest_completions_quest_run_id_fkey"
  FOREIGN KEY ("quest_run_id") REFERENCES "quest_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The ledger is the accounting source of truth. Corrections must be compensating entries.
CREATE FUNCTION prevent_wallet_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'wallet_ledger is append-only; insert a compensating entry instead';
END;
$$;

CREATE TRIGGER "wallet_ledger_no_update_or_delete"
BEFORE UPDATE OR DELETE ON "wallet_ledger"
FOR EACH ROW EXECUTE FUNCTION prevent_wallet_ledger_mutation();
