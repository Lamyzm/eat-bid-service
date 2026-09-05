CREATE TABLE "core"."source_supplier_account" (
	"source_supplier_account_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."source_supplier_account_source_supplier_account_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"supplier_party_id" bigint NOT NULL,
	"source_system" varchar(64) NOT NULL,
	"account_code_value_id" bigint NOT NULL CONSTRAINT "source_supplier_account_code_value_key" UNIQUE,
	"observation_id" bigint NOT NULL,
	CONSTRAINT "source_supplier_account_party_key" UNIQUE("source_supplier_account_id","supplier_party_id")
);
--> statement-breakpoint
CREATE TABLE "core"."supplier_party" (
	"supplier_party_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."supplier_party_supplier_party_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" varchar(32) NOT NULL,
	"canonical_name" text,
	"business_number_code_value_id" bigint CONSTRAINT "supplier_party_business_number_key" UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."source_supplier_account" ADD CONSTRAINT "source_supplier_account_VPfRNv90aatK_fkey" FOREIGN KEY ("supplier_party_id") REFERENCES "core"."supplier_party"("supplier_party_id");--> statement-breakpoint
ALTER TABLE "core"."source_supplier_account" ADD CONSTRAINT "source_supplier_account_38yy6xG90JMk_fkey" FOREIGN KEY ("account_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."source_supplier_account" ADD CONSTRAINT "source_supplier_account_OHq3xFYT7J4Q_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "core"."supplier_party" ADD CONSTRAINT "supplier_party_DfbWcxxC8xXE_fkey" FOREIGN KEY ("business_number_code_value_id") REFERENCES "core"."code_value"("code_value_id");