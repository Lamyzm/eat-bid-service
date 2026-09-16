CREATE TABLE "mart"."build_vocabulary_gap" (
	"build_id" bigint,
	"scheme_namespace" varchar(128),
	"fragment" text,
	"row_count" bigint NOT NULL,
	CONSTRAINT "build_vocabulary_gap_pkey" PRIMARY KEY("build_id","scheme_namespace","fragment"),
	CONSTRAINT "mart_build_vocabulary_gap_row_count_positive" CHECK ("row_count" > 0),
	CONSTRAINT "mart_build_vocabulary_gap_fragment_present" CHECK (length(btrim("fragment")) > 0)
);
--> statement-breakpoint
ALTER TABLE "mart"."build_vocabulary_gap" ADD CONSTRAINT "build_vocabulary_gap_build_id_build_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "mart"."build"("build_id");