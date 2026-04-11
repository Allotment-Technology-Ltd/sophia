-- Durable re-embed corpus jobs (Neon) — Surreal claim.embedding migration to target_dim (e.g. 1024).

CREATE TABLE IF NOT EXISTS "reembed_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"target_dim" integer DEFAULT 1024 NOT NULL,
	"stage" text DEFAULT 'pending' NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer,
	"cursor_offset" integer DEFAULT 0 NOT NULL,
	"batch_size" integer DEFAULT 50 NOT NULL,
	"last_error" text,
	"actor_email" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_reembed_jobs_status" ON "reembed_jobs" ("status");
CREATE INDEX IF NOT EXISTS "idx_reembed_jobs_updated" ON "reembed_jobs" ("updated_at");

CREATE TABLE IF NOT EXISTS "reembed_job_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"seq" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reembed_job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "reembed_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
	CONSTRAINT "reembed_job_events_job_seq_unique" UNIQUE ("job_id", "seq")
);

CREATE INDEX IF NOT EXISTS "idx_reembed_job_events_job" ON "reembed_job_events" ("job_id", "seq");
