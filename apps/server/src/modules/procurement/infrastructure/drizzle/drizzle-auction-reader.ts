/** @module 책임: 공고 한 건을 core 스키마에서 읽어 도메인 값으로 닫고 driver 시간 표현 경계를 소유한다. */
import { sql, type SQL } from "drizzle-orm";
import { Temporal } from "@eatbid/domain";
import type {
  AuctionReader,
  AuctionRecord,
  CodeReferenceRecord,
} from "../../application/auction-reader";
import { auctionId, type AuctionId } from "../../domain/auction-id";
import { bidRateValue, bigintValue, moneyValue } from "./postgres-row-values";

export interface AuctionReadDatabase {
  execute(query: SQL): Promise<unknown>;
}

type CodeReferenceColumns<Prefix extends string> =
  & Record<`${Prefix}_code_value_id`, string | bigint | null>
  & Record<`${Prefix}_code` | `${Prefix}_scheme` | `${Prefix}_label`, string | null>;

type AuctionRow = Readonly<
  & {
    auction_id: string | bigint;
    revision_id: string | bigint;
    title: string;
    source_status: string;
    display_bid_no: string | null;
    announced_at: Date | string | null;
    deadline_at: Date | string | null;
    opened_at: Date | string | null;
    base_amount: string | null;
    planned_amount: string | null;
    currency: string;
    organization_id: string | bigint | null;
    organization_name: string | null;
    organization_type: string | null;
    floor_rate: string | null;
    item_label: string | null;
    source_system: string;
    external_bid_id: string;
    observation_id: string | bigint;
    normalized_record_id: string | bigint;
    content_sha256: string;
  }
  & CodeReferenceColumns<"award_method">
  & CodeReferenceColumns<"location_sido">
  & CodeReferenceColumns<"location_sigungu">
>;

/**
 * AGENTS 17이 지정한 유일한 PostgreSQL 시간 경계다. driver가 주는 `Date | string`은 여기서만
 * 읽고 즉시 Temporal로 닫으므로 다른 어댑터도 이 함수를 통해서만 driver 시간을 해석한다.
 */
export function postgresInstant(value: Date | string | null): Temporal.Instant | null {
  if (value === null) return null;
  try {
    if (value instanceof Date) {
      const epochMilliseconds = value.getTime();
      if (!Number.isFinite(epochMilliseconds)) throw new TypeError("Database timestamp is invalid");
      return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds);
    }
    return Temporal.Instant.from(value);
  } catch {
    throw new TypeError("Database timestamp is invalid");
  }
}

// 공백뿐인 라벨은 관측된 것이 아니라 비어 있는 것이다. 기관 이름과 같은 규약을 코드 라벨에도 쓴다.
function observedLabel(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value.trim();
}

function codeReference(
  codeValueId: string | bigint | null,
  code: string | null,
  scheme: string | null,
  label: string | null,
): CodeReferenceRecord | null {
  // 코드 문자열만 있고 체계를 모르는 참조는 만들지 않는다. 체계 없는 코드는 정체성이 아니다(AGENTS 6).
  if (codeValueId === null || code === null || scheme === null) return null;
  return { codeValueId: bigintValue(codeValueId), code, scheme, label: observedLabel(label) };
}

// 블록 안이 전부 unknown이면 블록 자체가 없다. `{floorRate: null, awardMethod: null}`과 `null`이
// 둘 다 같은 뜻으로 살면 화면이 어느 쪽을 "미확인"으로 다뤄야 하는지 두 번 판단하게 된다.
function nullWhenEmpty<Block extends Record<string, unknown>>(block: Block): Block | null {
  return Object.values(block).every((value) => value === null) ? null : block;
}

export function mapAuctionRow(row: AuctionRow): AuctionRecord {
  const announcedAt = postgresInstant(row.announced_at);
  if (announcedAt === null) throw new TypeError("Database announced timestamp is required");
  const itemLabel = observedLabel(row.item_label);
  return {
    auctionId: auctionId(bigintValue(row.auction_id)),
    revisionId: bigintValue(row.revision_id),
    title: row.title,
    status: row.source_status,
    displayBidNumber: row.display_bid_no,
    announcedAt,
    deadlineAt: postgresInstant(row.deadline_at),
    openedAt: postgresInstant(row.opened_at),
    baseAmount: moneyValue(row.base_amount, row.currency, true),
    plannedAmount: moneyValue(row.planned_amount, row.currency, false),
    // 구매기관 관계가 없는 revision은 유효한 상태이므로 빈 이름이나 기본 유형을 지어내지 않는다.
    organization: row.organization_id === null || row.organization_type === null
      ? null
      : {
        organizationId: bigintValue(row.organization_id),
        // 공백뿐인 canonical_name은 이름이 관측된 것이 아니라 비어 있는 것이다. 빈 문자열을 이름으로
        // 내보내면 화면이 이름 없는 기관을 이름 있는 기관처럼 그린다.
        name: observedLabel(row.organization_name),
        type: row.organization_type,
      },
    terms: nullWhenEmpty({
      // core numeric(6,3) 하한율은 사정률 축의 상수다. scale 불변식은 이 경계에서 한 번만 닫는다.
      floorRate: bidRateValue(row.floor_rate),
      awardMethod: codeReference(
        row.award_method_code_value_id,
        row.award_method_code,
        row.award_method_scheme,
        row.award_method_label,
      ),
    }),
    location: nullWhenEmpty({
      sido: codeReference(
        row.location_sido_code_value_id,
        row.location_sido_code,
        row.location_sido_scheme,
        row.location_sido_label,
      ),
      sigungu: codeReference(
        row.location_sigungu_code_value_id,
        row.location_sigungu_code,
        row.location_sigungu_scheme,
        row.location_sigungu_label,
      ),
    }),
    classification: itemLabel === null ? null : { itemLabel },
    provenance: {
      sourceSystem: row.source_system,
      externalBidId: row.external_bid_id,
      observationId: bigintValue(row.observation_id),
      normalizedRecordId: bigintValue(row.normalized_record_id),
      contentSha256: row.content_sha256,
    },
  };
}

/**
 * role 하나의 코드 참조를 lateral 1행으로 닫는다. 평범한 left join으로 붙이면 한 revision에 같은
 * role의 코드가 둘 이상 달릴 때(관계 PK가 role까지만 막는다) 상위 행이 곱해져 `limit 1`이 어떤
 * 조합을 남길지 말할 수 없게 된다. 라벨은 정체성이 아니므로 가장 나중에 관측된 것 하나만 싣는다.
 */
function codeReferenceJoin(role: string, alias: string): SQL {
  return sql`
    left join lateral (
      select code.code_value_id,
             code.code,
             scheme.namespace as scheme,
             (select observation.label
                from core.code_label_observation observation
               where observation.code_value_id = code.code_value_id
               order by observation.observed_at desc, observation.code_label_observation_id desc
               limit 1) as label
        from core.auction_revision_code_value link
        join core.code_value code on code.code_value_id = link.code_value_id
        join core.code_scheme scheme on scheme.code_scheme_id = code.code_scheme_id
       where link.auction_revision_id = revision.auction_revision_id
         and link.role = ${role}
       order by code.code_value_id
       limit 1
    ) ${sql.raw(alias)} on true`;
}

export class DrizzleAuctionReader implements AuctionReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async findById(id: AuctionId): Promise<AuctionRecord | null> {
    // 이 API view는 여러 revision 중 가장 나중에 저장된 해석을 현재 값으로 선택하며, ID 역순이 그 projection 규칙을 명시한다.
    const result = await this.database.execute(sql`
      select
        attempt.auction_attempt_id as auction_id,
        revision.auction_revision_id as revision_id,
        revision.title,
        revision.source_status,
        revision.display_bid_no,
        revision.announced_at,
        revision.deadline_at,
        revision.opened_at,
        revision.base_amount,
        revision.planned_amount,
        revision.currency,
        revision.floor_rate,
        -- 품목 라벨은 관측 그대로의 문자열이며 회차 요약 mart가 읽는 자리와 같다. 코드가 아니다.
        revision.source_payload #>> '{classification,sourceCategoryLabel}' as item_label,
        purchaser_org.organization_id,
        purchaser_org.canonical_name as organization_name,
        purchaser_org.type as organization_type,
        award_method.code_value_id as award_method_code_value_id,
        award_method.code as award_method_code,
        award_method.scheme as award_method_scheme,
        award_method.label as award_method_label,
        location_sido.code_value_id as location_sido_code_value_id,
        location_sido.code as location_sido_code,
        location_sido.scheme as location_sido_scheme,
        location_sido.label as location_sido_label,
        location_sigungu.code_value_id as location_sigungu_code_value_id,
        location_sigungu.code as location_sigungu_code,
        location_sigungu.scheme as location_sigungu_scheme,
        location_sigungu.label as location_sigungu_label,
        attempt.source_system,
        attempt.external_bid_id,
        revision.observation_id,
        revision.normalized_record_id,
        revision.content_sha256
      from core.auction_attempt attempt
      join core.auction_revision revision
        on revision.auction_attempt_id = attempt.auction_attempt_id
      left join core.auction_organization purchaser
        on purchaser.auction_revision_id = revision.auction_revision_id
        and purchaser.role = 'purchaser'
      left join core.organization purchaser_org
        on purchaser_org.organization_id = purchaser.organization_id
      ${codeReferenceJoin("award_method", "award_method")}
      ${codeReferenceJoin("location_sido", "location_sido")}
      ${codeReferenceJoin("location_sigungu", "location_sigungu")}
      where attempt.auction_attempt_id = ${id}
      order by revision.auction_revision_id desc, purchaser_org.organization_id asc
      limit 1
    `);
    const rows = Array.isArray(result) ? result as AuctionRow[] : [];
    return rows[0] ? mapAuctionRow(rows[0]) : null;
  }
}
