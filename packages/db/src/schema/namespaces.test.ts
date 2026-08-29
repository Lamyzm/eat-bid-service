import { describe, expect, test } from "bun:test";

import { appSchema, coreSchema, ingestSchema, martSchema } from "./namespaces";

describe("database namespaces", () => {
  test("uses one schema per authority owner", () => {
    expect(ingestSchema.schemaName).toBe("ingest");
    expect(coreSchema.schemaName).toBe("core");
    expect(appSchema.schemaName).toBe("app");
    expect(martSchema.schemaName).toBe("mart");
  });
});
