import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://eatbid:eatbid@localhost:5434/eatbid";
export const sql = postgres(url, { max: 10 });
export const db = drizzle({ client: sql });
