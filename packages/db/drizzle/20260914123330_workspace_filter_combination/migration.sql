CREATE TABLE "app"."workspace_filter_combination" (
	"filter_combination_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."workspace_filter_combination_filter_combination_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" bigint NOT NULL,
	"name" text NOT NULL,
	"sido_code_value_id" bigint,
	"base_amount_min" numeric(18,2),
	"base_amount_max" numeric(18,2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_principal_id" bigint NOT NULL,
	CONSTRAINT "workspace_filter_combination_name_present" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "workspace_filter_combination_amount_order" CHECK ("base_amount_min" is null or "base_amount_max" is null
        or "base_amount_min" <= "base_amount_max")
);
--> statement-breakpoint
CREATE TABLE "app"."workspace_filter_combination_item" (
	"filter_combination_id" bigint,
	"label" text,
	CONSTRAINT "workspace_filter_combination_item_pkey" PRIMARY KEY("filter_combination_id","label"),
	CONSTRAINT "workspace_filter_combination_item_label_present" CHECK (length(btrim("label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."workspace_filter_combination_sigungu" (
	"filter_combination_id" bigint,
	"code_value_id" bigint,
	CONSTRAINT "workspace_filter_combination_sigungu_pkey" PRIMARY KEY("filter_combination_id","code_value_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_filter_combination_name_key" ON "app"."workspace_filter_combination" ("workspace_id","name");--> statement-breakpoint
ALTER TABLE "app"."workspace_filter_combination" ADD CONSTRAINT "workspace_filter_combination_gapdZV1kVlyO_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("workspace_id");--> statement-breakpoint
ALTER TABLE "app"."workspace_filter_combination" ADD CONSTRAINT "workspace_filter_combination_AkfVfzGuExoM_fkey" FOREIGN KEY ("sido_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "app"."workspace_filter_combination" ADD CONSTRAINT "workspace_filter_combination_Rtc24iRfwHig_fkey" FOREIGN KEY ("created_by_principal_id") REFERENCES "app"."principal"("principal_id");--> statement-breakpoint
ALTER TABLE "app"."workspace_filter_combination_item" ADD CONSTRAINT "workspace_filter_combination_item_h6skQFXAqs7L_fkey" FOREIGN KEY ("filter_combination_id") REFERENCES "app"."workspace_filter_combination"("filter_combination_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app"."workspace_filter_combination_sigungu" ADD CONSTRAINT "workspace_filter_combination_sigungu_qIVMhEw7YRZG_fkey" FOREIGN KEY ("filter_combination_id") REFERENCES "app"."workspace_filter_combination"("filter_combination_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app"."workspace_filter_combination_sigungu" ADD CONSTRAINT "workspace_filter_combination_sigungu_lAR72zM54Y99_fkey" FOREIGN KEY ("code_value_id") REFERENCES "core"."code_value"("code_value_id");