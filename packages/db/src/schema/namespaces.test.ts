import { describe, expect, test } from "bun:test";

import { appSchema, coreSchema, ingestSchema, martSchema } from "./namespaces";

describe("database namespace 격리", () => {
  test("authority owner마다 schema 하나를 사용한다", () => {
    expect(ingestSchema.schemaName).toBe("ingest");
    expect(coreSchema.schemaName).toBe("core");
    expect(appSchema.schemaName).toBe("app");
    expect(martSchema.schemaName).toBe("mart");
  });
});
