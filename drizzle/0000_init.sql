CREATE TABLE "id_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"phone_number" text,
	"address" jsonb,
	"residential_address" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "id_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "id_email_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"interaction_uid" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "id_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"use" text NOT NULL,
	"material" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "id_mock_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text NOT NULL,
	"html_body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "id_oidc" (
	"type" text NOT NULL,
	"id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"grant_id" text,
	"user_code" text,
	"uid" text,
	"expires_at" timestamp with time zone,
	CONSTRAINT "id_oidc_type_id_pk" PRIMARY KEY("type","id")
);
--> statement-breakpoint
CREATE TABLE "id_passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "id_passkeys" ADD CONSTRAINT "id_passkeys_account_id_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."id_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "id_accounts_email" ON "id_accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "id_email_codes_interaction" ON "id_email_codes" USING btree ("interaction_uid","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "id_email_codes_email" ON "id_email_codes" USING btree (lower("email"),"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "id_keys_use" ON "id_keys" USING btree ("use","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "id_oidc_grant" ON "id_oidc" USING btree ("grant_id") WHERE "id_oidc"."grant_id" is not null;--> statement-breakpoint
CREATE INDEX "id_oidc_uid" ON "id_oidc" USING btree ("uid") WHERE "id_oidc"."uid" is not null;--> statement-breakpoint
CREATE INDEX "id_oidc_user_code" ON "id_oidc" USING btree ("user_code") WHERE "id_oidc"."user_code" is not null;--> statement-breakpoint
CREATE INDEX "id_oidc_expires" ON "id_oidc" USING btree ("expires_at") WHERE "id_oidc"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "id_oidc_grant_account" ON "id_oidc" USING btree (("payload" ->> 'accountId')) WHERE "id_oidc"."type" = 'Grant';--> statement-breakpoint
CREATE INDEX "id_passkeys_account" ON "id_passkeys" USING btree ("account_id");