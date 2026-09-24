CREATE TABLE "id_policy_revisions" (
	"revision" text PRIMARY KEY NOT NULL,
	"disclosure" jsonb NOT NULL,
	"first_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
