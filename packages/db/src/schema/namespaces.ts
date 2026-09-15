import { pgSchema } from "drizzle-orm/pg-core";

export const ingestSchema = pgSchema("ingest");
export const coreSchema = pgSchema("core");
export const appSchema = pgSchema("app");
export const martSchema = pgSchema("mart");
// 운영 감시가 회차마다 남기는 모양 지표. 진실 원천이 아니라 관측의 기록이라 네 authority owner와 따로 둔다.
export const monitoringSchema = pgSchema("monitoring");
