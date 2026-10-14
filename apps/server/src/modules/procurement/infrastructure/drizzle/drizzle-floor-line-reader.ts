/**
 * @module 책임: 하한선 자리 port를 활성 회차 요약 build의 시군구·하한율·개찰 기간 조회와, 같은 회차의 명단에서 1~10등을 세우는 조회로 구현한다.
 *
 * 하한선은 mart에서 읽는다(예정가격·하한율·기초금액이 회차 요약에 있다). 1~10등은 mart에 없어 core 명단을 회차마다 읽는다.
 * 명단 조회에 회차의 개찰 시각을 함께 거는 이유는 `core.bid_submission`이 개찰 시각으로 나뉜 표라서다 — 시각 없이 거르면 해마다
 * 모든 조각을 훑는다(2026-10-15 운영 실측: 김해시 1년 2,091건 0.97초 → 0.24초, 결과 2,091건 동일).
 */
import { sql, type SQL } from "drizzle-orm";
import { baseRelativeBidRate, canonicalDecimal, type BaseRelativeBidRate } from "@eatbid/domain";

import type {
  FloorLineLadderRecord,
  FloorLinePointRecord,
  FloorLineReader,
  FloorLineRegionRecord,
  FloorLineWindow,
} from "../../application/floor-line-reader";
import type { MartBuildLineage } from "../../application/mart-build-lineage";
import { rateMilliText } from "../../application/distribution-statistics";
import { postgresInstant, type AuctionReadDatabase } from "./drizzle-auction-reader";
import { activeMartBuildId, ORG_ROUND_SUMMARY, readActiveMartBuildLineage } from "./drizzle-mart-build-reader";
import { organizationLabelSql } from "./organization-label-sql";
import { bigintValue, moneyValue, observedLabel } from "./postgres-row-values";

// 시각 열의 driver 표현은 PostgreSQL 어댑터가 정한 한 타입만 쓴다(ADR 0042, AGENTS 17).
type PostgresTimestamp = Parameters<typeof postgresInstant>[0];

const ACTIVE_BUILD = activeMartBuildId(ORG_ROUND_SUMMARY);
const BASE_RELATIVE_SCALE = 4;
/** 실격 투찰의 자리표시자 값(1e13대)을 거르는 상한이다. 다른 명단 조회와 같은 경계다(drizzle-bid-review-reader). */
const USABLE_RATE_CEILING = 200;

/**
 * 하한선이 그어진 회차다. 예정가격이 없으면 하한선도 없다. 격리된 회차는 화면 조회에서 뺀다(EAT-199). 분석 코호트와 달리
 * 낙찰 사정률을 요구하지 않는다 — 유찰된 공고도 그날 하한선은 그어졌다.
 */
function floorLinePredicate(window: FloorLineWindow): SQL {
  return sql`summary.build_id = ${ACTIVE_BUILD}
     and summary.quarantine_reason is null
     and summary.opened_at >= ${window.from.toString()}::timestamptz
     and summary.opened_at < ${window.before.toString()}::timestamptz
     and summary.floor_rate = ${rateMilliText(window.floorRateMilli)}::numeric
     and summary.planned_amount is not null
     and summary.base_amount > 0`;
}

function baseRelative(text: string): BaseRelativeBidRate {
  return baseRelativeBidRate(canonicalDecimal(text, BASE_RELATIVE_SCALE));
}

type PointRow = Readonly<{
  auction_attempt_id: string | bigint;
  auction_revision_id: string | bigint;
  opened_at: PostgresTimestamp;
  organization_name: string | null;
  base_amount: string;
  currency: string;
  floor: string;
}>;

type LadderRow = Readonly<{
  auction_attempt_id: string | bigint;
  valid_bidder_count: string | number;
  lowest: readonly string[] | null;
}>;

type RegionRow = Readonly<{
  sido_id: string | bigint;
  sido_label: string | null;
  sigungu_id: string | bigint;
  sigungu_label: string | null;
  point_count: string | number;
}>;

/** 코드값 하나의 가장 나중 관측 라벨이다. 이름은 정체성이 아니라 관측이다(AGENTS 2). */
function latestCodeLabel(codeValueId: SQL): SQL {
  return sql`(select observation.label from core.code_label_observation observation
               where observation.code_value_id = ${codeValueId}
               order by observation.observed_at desc, observation.code_label_observation_id desc
               limit 1)`;
}

function rowsOf<Row>(result: unknown): readonly Row[] {
  return Array.isArray(result) ? result as readonly Row[] : [];
}

export class DrizzleFloorLineReader implements FloorLineReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  activeLineage(): Promise<MartBuildLineage | null> {
    return readActiveMartBuildLineage(this.database, ORG_ROUND_SUMMARY);
  }

  async regionLabel(sigunguCodeValueId: bigint): Promise<string | null> {
    const rows = rowsOf<{ label: string | null }>(await this.database.execute(
      sql`select ${latestCodeLabel(sql`${sigunguCodeValueId.toString()}::bigint`)} as label`,
    ));
    return observedLabel(rows[0]?.label ?? null);
  }

  async readPoints(window: FloorLineWindow, sigunguCodeValueId: bigint): Promise<readonly FloorLinePointRecord[]> {
    // 기관 이름은 기관마다 한 번만 찾는다. 점마다 찾으면 수천 번의 라벨 조회가 된다.
    const result = await this.database.execute(sql`
      with point as (
        select summary.auction_attempt_id, summary.auction_revision_id, summary.opened_at, summary.organization_id,
               summary.base_amount, summary.currency,
               round(summary.planned_amount * summary.floor_rate / summary.base_amount, ${BASE_RELATIVE_SCALE}::int) as floor
          from mart.org_round_summary summary
         where ${floorLinePredicate(window)}
           and summary.region_sigungu_code_value_id = ${sigunguCodeValueId.toString()}::bigint
      ), organization_name as (
        select organization.organization_id, ${organizationLabelSql(sql`organization.organization_id`)} as name
          from (select distinct point.organization_id from point) organization
      )
      select point.auction_attempt_id, point.auction_revision_id, point.opened_at,
             organization_name.name as organization_name,
             point.base_amount::text as base_amount, point.currency, point.floor::text as floor
        from point
        left join organization_name on organization_name.organization_id = point.organization_id
       order by point.opened_at, point.auction_attempt_id`);
    return rowsOf<PointRow>(result).map((row) => {
      const openedAt = postgresInstant(row.opened_at);
      // 술어가 개찰 시각을 이미 요구했다. 여기서 비면 술어와 mart 제약이 갈라진 것이다.
      if (openedAt === null) throw new TypeError("Floor line row violates the opened-at invariant");
      return {
        attemptId: bigintValue(row.auction_attempt_id),
        revisionId: bigintValue(row.auction_revision_id),
        openedAt,
        organizationName: observedLabel(row.organization_name),
        baseAmount: moneyValue(row.base_amount, row.currency, true),
        floor: baseRelative(row.floor),
      };
    });
  }

  async readLadders(window: FloorLineWindow, sigunguCodeValueId: bigint): Promise<readonly FloorLineLadderRecord[]> {
    // 업체마다 가장 낮게 낸 값 하나로 줄 세운다. 투찰 금액 열은 실격 투찰에서 자리표시자라 쓰지 않고 예정가격 대비 투찰률을
    // 기초금액 대비로 옮긴다: 투찰률 × 예정가격 ÷ 기초금액.
    const result = await this.database.execute(sql`
      select summary.auction_attempt_id,
             ladder.valid_bidder_count,
             ladder.lowest
        from mart.org_round_summary summary
        cross join lateral (
          select count(*)::int as valid_bidder_count,
                 (array_agg(round(best.rate * summary.planned_amount / summary.base_amount, ${BASE_RELATIVE_SCALE}::int)::text
                            order by best.rate))[1:10] as lowest
            from (select min(bid.bid_rate) as rate
                    from core.bid_submission bid
                   where bid.auction_revision_id = summary.auction_revision_id
                     and bid.opened_at = summary.opened_at
                     and bid.bid_rate >= summary.floor_rate
                     and bid.bid_rate < ${USABLE_RATE_CEILING}
                   group by bid.supplier_party_id) best
        ) ladder
       where ${floorLinePredicate(window)}
         and summary.region_sigungu_code_value_id = ${sigunguCodeValueId.toString()}::bigint
         and ladder.valid_bidder_count > 0
       order by summary.opened_at, summary.auction_attempt_id`);
    return rowsOf<LadderRow>(result).map((row) => ({
      attemptId: bigintValue(row.auction_attempt_id),
      validBidderCount: Number(row.valid_bidder_count),
      lowest: (row.lowest ?? []).map(baseRelative),
    }));
  }

  async readRegions(window: FloorLineWindow): Promise<readonly FloorLineRegionRecord[]> {
    const result = await this.database.execute(sql`
      with region as (
        select summary.region_sido_code_value_id as sido_id, summary.region_sigungu_code_value_id as sigungu_id,
               count(*) as point_count
          from mart.org_round_summary summary
         where ${floorLinePredicate(window)}
           and summary.region_sido_code_value_id is not null
           and summary.region_sigungu_code_value_id is not null
         group by 1, 2
      )
      select region.sido_id, ${latestCodeLabel(sql`region.sido_id`)} as sido_label,
             region.sigungu_id, ${latestCodeLabel(sql`region.sigungu_id`)} as sigungu_label,
             region.point_count
        from region`);
    return rowsOf<RegionRow>(result).map((row) => ({
      sidoCodeValueId: bigintValue(row.sido_id),
      sidoLabel: observedLabel(row.sido_label),
      sigunguCodeValueId: bigintValue(row.sigungu_id),
      sigunguLabel: observedLabel(row.sigungu_label),
      pointCount: Number(row.point_count),
    }));
  }
}
