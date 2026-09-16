import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { ingestSourceHold } from "./source-hold";
import { checkNames, columnNames, columnNullability } from "../mart/table-config.fixture";

describe("ingest.source_hold 스키마", () => {
  test("보류는 ingest schema에 소스 단위 결정으로 쌓인다", () => {
    const config = getTableConfig(ingestSourceHold);

    expect(config.schema).toBe("ingest");
    expect(config.name).toBe("source_hold");
    expect(columnNames(ingestSourceHold)).toEqual([
      "hold_id",
      "source",
      "reason",
      "detail",
      "held_at",
      "held_by_run_id",
      "release_after",
      "released_at",
    ]);
  });

  test("풀리는 시각은 반드시 있고 사람이 일찍 푼 시각만 비어 있다", () => {
    const nullability = columnNullability(ingestSourceHold);

    expect(nullability.release_after).toBe(true);
    expect(nullability.released_at).toBe(false);
    expect(nullability.held_by_run_id).toBe(false);
  });

  test("사유 어휘와 시간 순서는 DB가 지킨다", () => {
    const checks = checkNames(ingestSourceHold);

    expect(checks).toContain("ingest_source_hold_reason");
    expect(checks).toContain("ingest_source_hold_release_after_held");
  });
});
