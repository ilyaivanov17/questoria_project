CREATE TYPE "QuestEditorialNotificationType" AS ENUM (
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHED'
);

CREATE TABLE "quest_editorial_notifications" (
  "id" UUID NOT NULL,
  "recipient_id" UUID NOT NULL,
  "quest_id" UUID NOT NULL,
  "quest_version_id" UUID NOT NULL,
  "type" "QuestEditorialNotificationType" NOT NULL,
  "message" TEXT NOT NULL,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quest_editorial_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quest_editorial_notifications_recipient_id_read_at_created_at_idx"
  ON "quest_editorial_notifications"("recipient_id", "read_at", "created_at");
CREATE INDEX "quest_editorial_notifications_quest_id_created_at_idx"
  ON "quest_editorial_notifications"("quest_id", "created_at");

ALTER TABLE "quest_editorial_notifications"
  ADD CONSTRAINT "quest_editorial_notifications_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quest_editorial_notifications"
  ADD CONSTRAINT "quest_editorial_notifications_quest_id_fkey"
  FOREIGN KEY ("quest_id") REFERENCES "quests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quest_editorial_notifications"
  ADD CONSTRAINT "quest_editorial_notifications_quest_version_id_fkey"
  FOREIGN KEY ("quest_version_id") REFERENCES "quest_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
