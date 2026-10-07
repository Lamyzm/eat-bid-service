CREATE TABLE "app"."operator_grant" (
	"operator_grant_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."operator_grant_operator_grant_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"principal_id" bigint NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_principal_id" bigint NOT NULL,
	"revoked_at" timestamp with time zone,
	"reason" text NOT NULL,
	CONSTRAINT "operator_grant_reason_present" CHECK (length(btrim("reason")) > 0),
	CONSTRAINT "operator_grant_revoked_after_granted" CHECK ("revoked_at" is null or "revoked_at" >= "granted_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operator_grant_active_principal_key" ON "app"."operator_grant" ("principal_id") WHERE "revoked_at" is null;--> statement-breakpoint
CREATE INDEX "operator_grant_principal_idx" ON "app"."operator_grant" ("principal_id");--> statement-breakpoint
ALTER TABLE "app"."operator_grant" ADD CONSTRAINT "operator_grant_principal_id_principal_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "app"."principal"("principal_id");--> statement-breakpoint
ALTER TABLE "app"."operator_grant" ADD CONSTRAINT "operator_grant_granted_by_principal_fkey" FOREIGN KEY ("granted_by_principal_id") REFERENCES "app"."principal"("principal_id");