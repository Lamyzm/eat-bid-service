DROP INDEX "app"."auth_account_issuer_accountId_uidx";--> statement-breakpoint
ALTER TABLE "app"."auth_account" DROP COLUMN "issuer";