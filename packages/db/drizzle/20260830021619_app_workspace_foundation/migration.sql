CREATE TABLE "app"."identity_subject" (
	"identity_subject_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."identity_subject_identity_subject_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"principal_id" bigint NOT NULL,
	"provider" varchar(64) NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_subject_provider_issuer_subject_key" UNIQUE("provider","issuer","subject")
);
--> statement-breakpoint
CREATE TABLE "app"."principal" (
	"principal_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."principal_principal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."workspace" (
	"workspace_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."workspace_workspace_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."workspace_membership" (
	"workspace_id" bigint,
	"principal_id" bigint,
	"role" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_membership_pkey" PRIMARY KEY("workspace_id","principal_id")
);
--> statement-breakpoint
ALTER TABLE "app"."identity_subject" ADD CONSTRAINT "identity_subject_principal_id_principal_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "app"."principal"("principal_id");--> statement-breakpoint
ALTER TABLE "app"."workspace_membership" ADD CONSTRAINT "workspace_membership_workspace_id_workspace_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("workspace_id");--> statement-breakpoint
ALTER TABLE "app"."workspace_membership" ADD CONSTRAINT "workspace_membership_principal_id_principal_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "app"."principal"("principal_id");