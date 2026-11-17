ALTER TYPE "QuestVersionStatus" ADD VALUE 'APPROVED';

ALTER TABLE "users"
  ADD COLUMN "mfa_secret_encrypted" TEXT,
  ADD COLUMN "mfa_enabled_at" TIMESTAMP(3);

ALTER TABLE "sessions"
  ADD COLUMN "mfa_verified_at" TIMESTAMP(3);

ALTER TABLE "quest_versions"
  ADD COLUMN "internal_name" TEXT,
  ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "cover_url" TEXT,
  ADD COLUMN "cover_alt" TEXT,
  ADD COLUMN "cover_license_source" TEXT,
  ADD COLUMN "author_id" UUID,
  ADD COLUMN "reviewer_id" UUID,
  ADD COLUMN "approved_by_id" UUID,
  ADD COLUMN "published_by_id" UUID,
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "quest_versions"
  ADD CONSTRAINT "quest_versions_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "quest_versions_reviewer_id_fkey"
    FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "quest_versions_approved_by_id_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "quest_versions_published_by_id_fkey"
    FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "admin_audit_logs" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "before_json" JSONB,
  "after_json" JSONB,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_audit_logs_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "admin_audit_logs_entity_type_entity_id_created_at_idx"
  ON "admin_audit_logs"("entity_type", "entity_id", "created_at");
CREATE INDEX "admin_audit_logs_actor_user_id_created_at_idx"
  ON "admin_audit_logs"("actor_user_id", "created_at");

CREATE OR REPLACE FUNCTION "questoria_guard_published_quest_version"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'PUBLISHED' THEN
      RAISE EXCEPTION 'Published quest versions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'PUBLISHED' AND (
    NEW."status" NOT IN ('PUBLISHED', 'ARCHIVED')
    OR (to_jsonb(NEW) - 'status' - 'updated_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'updated_at')
  ) THEN
    RAISE EXCEPTION 'Published quest versions are immutable; create a new version';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quest_versions_published_immutable"
BEFORE UPDATE OR DELETE ON "quest_versions"
FOR EACH ROW EXECUTE FUNCTION "questoria_guard_published_quest_version"();

CREATE OR REPLACE FUNCTION "questoria_child_parent_is_published"(table_name TEXT, parent_id UUID)
RETURNS BOOLEAN AS $$
DECLARE published BOOLEAN;
BEGIN
  IF table_name = 'levels' THEN
    SELECT "status" = 'PUBLISHED' INTO published
    FROM "quest_versions" WHERE "id" = parent_id;
  ELSIF table_name = 'puzzles' THEN
    SELECT qv."status" = 'PUBLISHED' INTO published
    FROM "levels" l JOIN "quest_versions" qv ON qv."id" = l."quest_version_id"
    WHERE l."id" = parent_id;
  ELSIF table_name = 'hints' THEN
    SELECT qv."status" = 'PUBLISHED' INTO published
    FROM "puzzles" p
    JOIN "levels" l ON l."id" = p."level_id"
    JOIN "quest_versions" qv ON qv."id" = l."quest_version_id"
    WHERE p."id" = parent_id;
  END IF;
  RETURN COALESCE(published, FALSE);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION "questoria_guard_published_child"()
RETURNS trigger AS $$
DECLARE old_parent UUID;
DECLARE new_parent UUID;
BEGIN
  IF TG_TABLE_NAME = 'levels' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN old_parent := OLD."quest_version_id"; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN new_parent := NEW."quest_version_id"; END IF;
  ELSIF TG_TABLE_NAME = 'puzzles' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN old_parent := OLD."level_id"; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN new_parent := NEW."level_id"; END IF;
  ELSIF TG_TABLE_NAME = 'hints' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN old_parent := OLD."puzzle_id"; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN new_parent := NEW."puzzle_id"; END IF;
  END IF;

  IF old_parent IS NOT NULL AND "questoria_child_parent_is_published"(TG_TABLE_NAME, old_parent) THEN
    RAISE EXCEPTION 'Published quest content cannot be changed; create a new version';
  END IF;
  IF new_parent IS NOT NULL AND "questoria_child_parent_is_published"(TG_TABLE_NAME, new_parent) THEN
    RAISE EXCEPTION 'Published quest content cannot be changed; create a new version';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "levels_published_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "levels"
FOR EACH ROW EXECUTE FUNCTION "questoria_guard_published_child"();

CREATE TRIGGER "puzzles_published_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "puzzles"
FOR EACH ROW EXECUTE FUNCTION "questoria_guard_published_child"();

CREATE TRIGGER "hints_published_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "hints"
FOR EACH ROW EXECUTE FUNCTION "questoria_guard_published_child"();

CREATE OR REPLACE FUNCTION "questoria_guard_audit_log_append_only"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Admin audit logs are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "admin_audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "admin_audit_logs"
FOR EACH ROW EXECUTE FUNCTION "questoria_guard_audit_log_append_only"();
