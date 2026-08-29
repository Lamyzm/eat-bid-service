import { pgSchema } from "drizzle-orm/pg-core";

export const ingestSchema = pgSchema("ingest");
export const coreSchema = pgSchema("core");
export const appSchema = pgSchema("app");
export const martSchema = pgSchema("mart");
