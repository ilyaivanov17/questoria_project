CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "QuestVersionStatus" AS ENUM ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "QuestRunStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "email_verified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "profiles" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "nickname" TEXT,
  "age_band" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'ru',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "roles" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_roles" (
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id")
);

CREATE TABLE "categories" (
  "id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'ru',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "ContentStatus" NOT NULL DEFAULT 'PUBLISHED',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quests" (
  "id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quest_versions" (
  "id" UUID NOT NULL,
  "quest_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "objectives" JSONB NOT NULL,
  "age_min" INTEGER NOT NULL,
  "age_max" INTEGER NOT NULL,
  "difficulty" TEXT NOT NULL,
  "duration_min" INTEGER NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'ru',
  "seo" JSONB,
  "status" "QuestVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quest_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "levels" (
  "id" UUID NOT NULL,
  "quest_version_id" UUID NOT NULL,
  "order_no" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "intro" TEXT NOT NULL,
  CONSTRAINT "levels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "puzzles" (
  "id" UUID NOT NULL,
  "level_id" UUID NOT NULL,
  "order_no" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "public_payload" JSONB NOT NULL,
  "solution_private" JSONB NOT NULL,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "max_score" INTEGER NOT NULL DEFAULT 10,
  CONSTRAINT "puzzles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hints" (
  "id" UUID NOT NULL,
  "puzzle_id" UUID NOT NULL,
  "order_no" INTEGER NOT NULL,
  "body" TEXT NOT NULL,
  CONSTRAINT "hints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quest_runs" (
  "id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "quest_version_id" UUID NOT NULL,
  "status" "QuestRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quest_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "puzzle_attempts" (
  "id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "quest_run_id" UUID NOT NULL,
  "puzzle_id" UUID NOT NULL,
  "attempt_key" TEXT NOT NULL,
  "answer" JSONB NOT NULL,
  "is_correct" BOOLEAN NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "feedback" TEXT NOT NULL,
  "attempts_remaining" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "puzzle_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_normalized_key" ON "users"("email_normalized");
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");
CREATE UNIQUE INDEX "categories_locale_slug_key" ON "categories"("locale", "slug");
CREATE INDEX "categories_status_sort_order_idx" ON "categories"("status", "sort_order");
CREATE UNIQUE INDEX "quests_slug_key" ON "quests"("slug");
CREATE INDEX "quests_category_id_status_idx" ON "quests"("category_id", "status");
CREATE UNIQUE INDEX "quest_versions_quest_id_version_no_key" ON "quest_versions"("quest_id", "version_no");
CREATE INDEX "quest_versions_quest_id_status_idx" ON "quest_versions"("quest_id", "status");
CREATE UNIQUE INDEX "levels_quest_version_id_order_no_key" ON "levels"("quest_version_id", "order_no");
CREATE UNIQUE INDEX "puzzles_level_id_order_no_key" ON "puzzles"("level_id", "order_no");
CREATE UNIQUE INDEX "hints_puzzle_id_order_no_key" ON "hints"("puzzle_id", "order_no");
CREATE INDEX "quest_runs_profile_id_status_idx" ON "quest_runs"("profile_id", "status");
CREATE INDEX "quest_runs_quest_version_id_idx" ON "quest_runs"("quest_version_id");
CREATE UNIQUE INDEX "puzzle_attempts_profile_id_attempt_key_key" ON "puzzle_attempts"("profile_id", "attempt_key");
CREATE INDEX "puzzle_attempts_quest_run_id_puzzle_id_created_at_idx" ON "puzzle_attempts"("quest_run_id", "puzzle_id", "created_at");

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quests" ADD CONSTRAINT "quests_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quest_versions" ADD CONSTRAINT "quest_versions_quest_id_fkey"
  FOREIGN KEY ("quest_id") REFERENCES "quests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "levels" ADD CONSTRAINT "levels_quest_version_id_fkey"
  FOREIGN KEY ("quest_version_id") REFERENCES "quest_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "puzzles" ADD CONSTRAINT "puzzles_level_id_fkey"
  FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hints" ADD CONSTRAINT "hints_puzzle_id_fkey"
  FOREIGN KEY ("puzzle_id") REFERENCES "puzzles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quest_runs" ADD CONSTRAINT "quest_runs_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quest_runs" ADD CONSTRAINT "quest_runs_quest_version_id_fkey"
  FOREIGN KEY ("quest_version_id") REFERENCES "quest_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "puzzle_attempts" ADD CONSTRAINT "puzzle_attempts_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "puzzle_attempts" ADD CONSTRAINT "puzzle_attempts_quest_run_id_fkey"
  FOREIGN KEY ("quest_run_id") REFERENCES "quest_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "puzzle_attempts" ADD CONSTRAINT "puzzle_attempts_puzzle_id_fkey"
  FOREIGN KEY ("puzzle_id") REFERENCES "puzzles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
