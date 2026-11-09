CREATE TABLE "free_flyer_grants" (
	"phone" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"flyers" integer NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "free_flyer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "free_flyers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "free_flyer_grants" ADD CONSTRAINT "free_flyer_grants_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "free_flyers_non_negative" CHECK ("profiles"."free_flyers" >= 0);