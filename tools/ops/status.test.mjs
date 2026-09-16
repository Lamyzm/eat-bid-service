import assert from "node:assert/strict";
import test from "node:test";

import { QUERIES } from "./status.mjs";

test("운영 상태 질의는 전부 읽기이고 진단 지도의 다섯 질문을 덮는다", () => {
  assert.equal(QUERIES.length, 5);
  for (const { title, sql } of QUERIES) {
    const head = sql.trim().slice(0, 6).toLowerCase();
    assert.equal(head, "select", title);
    assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|alter|drop)\b/iu, title);
  }
  const all = QUERIES.map((q) => q.sql).join(" ");
  for (const table of ["monitoring.violation", "monitoring.round", "monitoring.notification", "ingest.backfill_coverage", "ingest.source_hold"]) {
    assert.match(all, new RegExp(table.replace(".", "\\.")), table);
  }
});
