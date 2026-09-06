/** @module 책임: 코드 목록 port를 활성 code release 한 벌과 그 release의 좌표 관측 조회로 구현한다. */
import { sql, type SQL } from "drizzle-orm";
import { Temporal } from "@eatbid/domain";
import type {
  CodeListingQuery,
  CodeReader,
  CodeReleaseListing,
  ObservedCoordinateRecord,
  RegionCodeRecord,
} from "../../application/code-reader";

export interface CodeReadDatabase {
  execute(query: SQL): Promise<unknown>;
}

// 시각을 UTC canonical 텍스트로 좁혀 받는다. driver가 주는 시간 표현을 읽을 수 있는 파일은
// `drizzle-auction-reader.ts` 하나이고(AGENTS 17), feature 경계는 그 파일을 여기서 import하지 못하게
// 막는다. 두 규칙을 함께 지키는 유일한 길은 조회가 표현을 먼저 좁히는 것이다.
const UTC_INSTANT_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

type ReleaseRow = Readonly<{
  code_release_id: string | bigint;
  source_version: string;
  published_at: string | null;
  promoted_grain: readonly string[];
}>;

type MemberRow = Readonly<{
  code_value_id: string | bigint;
  code: string;
  label: string | null;
  parent_code_value_id: string | bigint | null;
  grain: string;
  active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  latitude: string | null;
  longitude: string | null;
  crs: string | null;
}>;

/**
 * 식별자 변환을 procurement 어댑터와 공유하지 않는 이유는 feature 사이의 내부 계층 import가 막혀
 * 있기 때문이다. 같은 불변식이라도 각 feature의 저장 경계가 스스로 닫는다.
 */
function codeIdentifier(value: string | bigint): bigint {
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed <= 0n) throw new TypeError("Database ID must be a positive bigint");
  return parsed;
}

function instantOf(value: string | null): Temporal.Instant | null {
  if (value === null) return null;
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new TypeError("Database timestamp is invalid");
  }
}

/**
 * 위경도는 공개 계약이 JSON number로 정한 값이라 여기가 numeric 문자열을 닫는 유일한 경계다.
 * DDL이 `numeric(9,6)`과 지구 범위 check를 이미 강제하므로 여기서는 그 사실이 깨졌는지만 확인하고
 * 조용히 잘라내지 않는다.
 */
function coordinateOf(row: MemberRow): ObservedCoordinateRecord | null {
  if (row.latitude === null || row.longitude === null || row.crs === null) return null;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new TypeError("Database coordinate latitude is invalid");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new TypeError("Database coordinate longitude is invalid");
  }
  // CRS 허용 목록은 DDL이 소유한다. 다른 값이 왔다면 제약이 사라진 것이므로 좌표를 만들지 않는다.
  if (row.crs !== "EPSG:4326") throw new TypeError("Database coordinate CRS is not supported");
  return { latitude, longitude, crs: "EPSG:4326" };
}

export function mapMemberRow(row: MemberRow): RegionCodeRecord {
  // 라벨 없는 member는 release 계약이 깨진 것이다(`code_release_v1`의 member는 label을 요구한다).
  // 코드 문자열로 메우면 화면이 지어낸 이름을 정부가 준 이름으로 읽는다.
  if (row.label === null || row.label.trim() === "") {
    throw new TypeError("Database code release member has no observed label");
  }
  return {
    codeValueId: codeIdentifier(row.code_value_id),
    code: row.code,
    label: row.label.trim(),
    parentCodeValueId: row.parent_code_value_id === null ? null : codeIdentifier(row.parent_code_value_id),
    grain: row.grain,
    active: row.active,
    validFrom: instantOf(row.valid_from),
    validTo: instantOf(row.valid_to),
    coordinate: coordinateOf(row),
  };
}

export class DrizzleCodeReader implements CodeReader {
  constructor(private readonly database: CodeReadDatabase) {}

  async readActiveRelease(query: CodeListingQuery): Promise<CodeReleaseListing | null> {
    const release = await this.activeRelease(query.scheme);
    if (release === null) return null;
    const codes = await this.members(codeIdentifier(release.code_release_id), query.grain);
    return {
      release: {
        codeReleaseId: codeIdentifier(release.code_release_id),
        sourceVersion: release.source_version,
        publishedAt: instantOf(release.published_at),
        promotedGrain: [...release.promoted_grain],
      },
      codes,
    };
  }

  /**
   * code release에는 mart build 같은 활성 포인터가 없다. 정정 파일은 기존 member를 고치지 않고 새
   * release가 되므로(ADR 0035) 가장 나중에 봉인된 release가 활성이다. `published_at`으로 정렬하지
   * 않는 이유는 원본이 기준일자를 주지 않으면 null이라 그 축이 순서를 말하지 못하기 때문이다.
   */
  private async activeRelease(scheme: string): Promise<ReleaseRow | null> {
    const result = await this.database.execute(sql`
      select release.code_release_id,
             release.source_version,
             to_char(release.published_at at time zone 'utc', ${UTC_INSTANT_FORMAT}) as published_at,
             release.promoted_grain
      from core.code_release release
      join core.code_scheme scheme using (code_scheme_id)
      where scheme.namespace = ${scheme}
      order by release.code_release_id desc
      limit 1
    `);
    const rows = Array.isArray(result) ? result as ReleaseRow[] : [];
    return rows[0] ?? null;
  }

  /**
   * 라벨은 관측이라 한 코드에 여러 행이 있을 수 있으므로 가장 나중에 관측된 하나만 읽는다.
   * 좌표는 **같은 release의 관측**만 붙인다. 다른 release의 점을 끌어오면 개편 전 좌표가 개편 뒤
   * 목록에 섞인다. 응답 계약의 목록 상한을 여기서 자르지 않는 이유는, 상한을 넘긴 release는 조용히
   * 잘라 보여줄 것이 아니라 응답 schema가 실패로 드러내야 할 사실이기 때문이다.
   */
  private async members(codeReleaseId: bigint, grain: string | null): Promise<RegionCodeRecord[]> {
    const result = await this.database.execute(sql`
      select member.code_value_id,
             value.code,
             observed.label,
             member.parent_code_value_id,
             member.grain,
             member.active,
             to_char(member.valid_from at time zone 'utc', ${UTC_INSTANT_FORMAT}) as valid_from,
             to_char(member.valid_to at time zone 'utc', ${UTC_INSTANT_FORMAT}) as valid_to,
             coordinate.latitude,
             coordinate.longitude,
             coordinate.crs
      from core.code_release_member member
      join core.code_value value on value.code_value_id = member.code_value_id
      left join lateral (
        select label.label
        from core.code_label_observation label
        where label.code_value_id = member.code_value_id
        order by label.observed_at desc, label.code_label_observation_id desc
        limit 1
      ) observed on true
      left join core.code_value_coordinate coordinate
        on coordinate.code_release_id = member.code_release_id
       and coordinate.code_value_id = member.code_value_id
      where member.code_release_id = ${codeReleaseId}::bigint
        and (${grain}::text is null or member.grain = ${grain}::text)
      order by value.code
    `);
    const rows = Array.isArray(result) ? result as MemberRow[] : [];
    return rows.map(mapMemberRow);
  }
}
