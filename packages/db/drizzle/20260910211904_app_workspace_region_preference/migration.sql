CREATE TABLE "app"."workspace_region_preference" (
	"workspace_id" bigint PRIMARY KEY,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by_principal_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."workspace_region_preference_area" (
	"workspace_id" bigint,
	"code_value_id" bigint,
	CONSTRAINT "workspace_region_preference_area_pkey" PRIMARY KEY("workspace_id","code_value_id")
);
--> statement-breakpoint
ALTER TABLE "app"."workspace_region_preference" ADD CONSTRAINT "workspace_region_preference_27yv0nw7634w_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("workspace_id");--> statement-breakpoint
ALTER TABLE "app"."workspace_region_preference" ADD CONSTRAINT "workspace_region_preference_XFbW3VUxOQAV_fkey" FOREIGN KEY ("confirmed_by_principal_id") REFERENCES "app"."principal"("principal_id");--> statement-breakpoint
ALTER TABLE "app"."workspace_region_preference_area" ADD CONSTRAINT "workspace_region_preference_area_ZwkAlMzPE98t_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace_region_preference"("workspace_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app"."workspace_region_preference_area" ADD CONSTRAINT "workspace_region_preference_area_WRcELAarDbFy_fkey" FOREIGN KEY ("code_value_id") REFERENCES "core"."code_value"("code_value_id");