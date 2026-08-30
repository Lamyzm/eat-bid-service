import { describe, expect, test } from "bun:test";

import { appSchema, coreSchema, ingestSchema, martSchema } from "./namespaces";

describe("검증 범위를 정의한다 — database namespaces", () => {
  test("사용 계약을 검증한다 — uses one schema per authority owner", () => {
    expect(ingestSchema.schemaName).toBe("ingest");
    expect(coreSchema.schemaName).toBe("core");
    expect(appSchema.schemaName).toBe("app");
    expect(martSchema.schemaName).toBe("mart");
  });
});
