import { describe, expect, test } from "bun:test";

import { appSchema, coreSchema, ingestSchema, martSchema, monitoringSchema } from "./namespaces";

describe("database namespace 격리", () => {
  test("authority owner마다 schema 하나를 사용한다", () => {
    expect(ingestSchema.schemaName).toBe("ingest");
    expect(coreSchema.schemaName).toBe("core");
    expect(appSchema.schemaName).toBe("app");
    expect(martSchema.schemaName).toBe("mart");
  });

  test("감시 지표는 authority owner 넷과 따로 monitoring schema에 둔다", () => {
    expect(monitoringSchema.schemaName).toBe("monitoring");
  });
});
