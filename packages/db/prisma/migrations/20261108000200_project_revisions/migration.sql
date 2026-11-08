-- CreateTable
CREATE TABLE "project_revisions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "generation_id" TEXT,
    "source_url" TEXT NOT NULL,
    "result_url" TEXT,
    "targets" JSONB NOT NULL DEFAULT '[]',
    "credits_spent" INTEGER NOT NULL DEFAULT 0,
    "charge_key" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "project_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_revisions_project_id_created_at_idx" ON "project_revisions"("project_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "project_revisions" ADD CONSTRAINT "project_revisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "flyer_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_revisions" ADD CONSTRAINT "project_revisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
