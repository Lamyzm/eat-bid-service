CREATE TABLE "app"."auth_account" (
	"id" text PRIMARY KEY,
	"issuer" text NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."auth_rate_limit" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."auth_session" (
	"id" text PRIMARY KEY,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."auth_user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."auth_verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."registered_business" (
	"registered_business_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."registered_business_registered_business_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" bigint NOT NULL,
	"business_number" char(10) NOT NULL,
	"registered_by_principal_id" bigint NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "registered_business_number_digits" CHECK ("business_number" ~ '^[0-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "app"."registered_business_location" (
	"registered_business_id" bigint PRIMARY KEY,
	"address_text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_principal_id" bigint NOT NULL,
	CONSTRAINT "registered_business_location_address_present" CHECK (length(btrim("address_text")) > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."principal_default_workspace" (
	"principal_id" bigint PRIMARY KEY,
	"workspace_id" bigint NOT NULL,
	"initialized_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_issuer_accountId_uidx" ON "app"."auth_account" ("issuer","accountId");--> statement-breakpoint
CREATE INDEX "auth_account_userId_idx" ON "app"."auth_account" ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limit_key_uidx" ON "app"."auth_rate_limit" ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_session_token_uidx" ON "app"."auth_session" ("token");--> statement-breakpoint
CREATE INDEX "auth_session_userId_idx" ON "app"."auth_session" ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_user_email_uidx" ON "app"."auth_user" ("email");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "app"."auth_verification" ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "registered_business_active_number_key" ON "app"."registered_business" ("workspace_id","business_number") WHERE "revoked_at" is null;--> statement-breakpoint
ALTER TABLE "app"."auth_account" ADD CONSTRAINT "auth_account_userId_auth_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "app"."auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app"."auth_session" ADD CONSTRAINT "auth_session_userId_auth_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "app"."auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app"."registered_business" ADD CONSTRAINT "registered_business_workspace_id_workspace_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("workspace_id");--> statement-breakpoint
ALTER TABLE "app"."registered_business" ADD CONSTRAINT "registered_business_pb1RNpe5ICTb_fkey" FOREIGN KEY ("registered_by_principal_id") REFERENCES "app"."principal"("principal_id");--> statement-breakpoint
ALTER TABLE "app"."registered_business_location" ADD CONSTRAINT "registered_business_location_TIT3Oar0x7FB_fkey" FOREIGN KEY ("registered_business_id") REFERENCES "app"."registered_business"("registered_business_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app"."registered_business_location" ADD CONSTRAINT "registered_business_location_0ZemB2Dw5ah8_fkey" FOREIGN KEY ("updated_by_principal_id") REFERENCES "app"."principal"("principal_id");--> statement-breakpoint
ALTER TABLE "app"."principal_default_workspace" ADD CONSTRAINT "principal_default_workspace_Ry7IUbDdyrRD_fkey" FOREIGN KEY ("principal_id") REFERENCES "app"."principal"("principal_id");--> statement-breakpoint
ALTER TABLE "app"."principal_default_workspace" ADD CONSTRAINT "principal_default_workspace_YByTAirXwEu8_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("workspace_id");--> statement-breakpoint
ALTER TABLE "app"."workspace_membership" ADD CONSTRAINT "workspace_membership_role_allowed" CHECK ("role" in ('owner', 'member'));