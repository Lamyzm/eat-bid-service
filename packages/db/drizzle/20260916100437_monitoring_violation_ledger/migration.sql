CREATE TABLE "monitoring"."notification" (
	"notification_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring"."notification_notification_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment" varchar(16) NOT NULL,
	"violation_id" bigint,
	"kind" varchar(16) NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	CONSTRAINT "monitoring_notification_kind" CHECK ("kind" in ('opened', 'repeat', 'resolved', 'digest')),
	CONSTRAINT "monitoring_notification_error_only_on_failure" CHECK ("ok" or "error" is not null)
);
--> statement-breakpoint
CREATE TABLE "monitoring"."violation" (
	"violation_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring"."violation_violation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment" varchar(16) NOT NULL,
	"violation_key" varchar(200) NOT NULL,
	"expectation_key" varchar(64) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"runbook" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"observation" varchar(16) NOT NULL,
	"resolved_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	CONSTRAINT "monitoring_violation_severity" CHECK ("severity" in ('critical', 'normal')),
	CONSTRAINT "monitoring_violation_observation" CHECK ("observation" in ('observed', 'unobserved')),
	CONSTRAINT "monitoring_violation_timeline" CHECK ("last_seen_at" >= "first_seen_at"
        and ("resolved_at" is null or "resolved_at" >= "first_seen_at"))
);
--> statement-breakpoint
CREATE INDEX "monitoring_notification_environment_sent_idx" ON "monitoring"."notification" ("environment","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_violation_open_key_unique" ON "monitoring"."violation" ("environment","violation_key") WHERE "resolved_at" is null;--> statement-breakpoint
CREATE INDEX "monitoring_violation_environment_resolved_idx" ON "monitoring"."violation" ("environment","resolved_at");--> statement-breakpoint
ALTER TABLE "monitoring"."notification" ADD CONSTRAINT "notification_violation_id_violation_violation_id_fkey" FOREIGN KEY ("violation_id") REFERENCES "monitoring"."violation"("violation_id");