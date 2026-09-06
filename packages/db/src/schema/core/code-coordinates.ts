/** @module 책임: 코드 값의 좌표를 CRS·근거 observation과 함께 별도 release 관측으로 저장한다. */
import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, numeric, unique, varchar } from "drizzle-orm/pg-core";

import { rawObservation } from "../ingest/evidence.js";
import { coreSchema } from "../namespaces.js";
import { codeValue } from "./codes.js";
import { codeRelease } from "./code-releases.js";

// 좌표를 `code_value`의 열로 두지 않는 이유: 행안부가 주지 않은 값을 정부 코드 행이 들게 되고
// `eat:bid-status` 같은 비지리 체계까지 nullable 좌표 열을 갖는 범주 오류가 된다(ADR 0035 결정 5).
// 저장이 `numeric`인 이유: canonical 사실에 floating-point DDL을 쓰지 않는다(domain-and-data §8).
export const codeValueCoordinate = coreSchema.table(
  "code_value_coordinate",
  {
    codeValueCoordinateId: bigint("code_value_coordinate_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    codeValueId: bigint("code_value_id", { mode: "bigint" }).notNull(),
    codeReleaseId: bigint("code_release_id", { mode: "bigint" }).notNull(),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    crs: varchar("crs", { length: 32 }).notNull(),
    evidenceObservationId: bigint("evidence_observation_id", { mode: "bigint" }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "code_value_coordinate_code_value_fkey",
      columns: [table.codeValueId],
      foreignColumns: [codeValue.codeValueId],
    }),
    foreignKey({
      name: "code_value_coordinate_code_release_fkey",
      columns: [table.codeReleaseId],
      foreignColumns: [codeRelease.codeReleaseId],
    }),
    foreignKey({
      name: "code_value_coordinate_evidence_fkey",
      columns: [table.evidenceObservationId],
      foreignColumns: [rawObservation.observationId],
    }),
    // 한 release 안에서 한 코드의 좌표는 하나다. 두 행이면 어느 점이 그 release의 관측인지 화면이
    // 고르게 되고, 그 판정이 코드가 아니라 정렬 순서에 달린다.
    unique("code_value_coordinate_release_code_key").on(table.codeReleaseId, table.codeValueId),
    // CRS를 자유 문자열로 두면 다른 좌표계 값이 같은 열에 섞여도 아무도 모른다. 지금 받는 소스는
    // 경위도 하나뿐이므로 허용 목록도 하나다. 늘어나면 그때 목록을 늘린다.
    check("code_value_coordinate_crs_allowed", sql`${table.crs} = 'EPSG:4326'`),
    check(
      "code_value_coordinate_within_earth",
      sql`${table.latitude} between -90 and 90 and ${table.longitude} between -180 and 180`,
    ),
  ],
);
