/**
 * @module 책임: 오늘 화면이 읽는 열린 공고 관측 스냅샷 `mart.open_auction_snapshot`을 소유한다.
 *
 * 이 mart만 수명주기가 다르다. 참여 수 추이는 지난 관측점을 되돌아보므로 물린 build의 행을 곧바로
 * 지우지 않고 `mart.build.retain_until`이 지난 뒤에 회수한다(ADR 0034).
 */
import { bigint, char, check, index, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { codeValue } from "../core/codes.js";
import { organization } from "../core/organizations.js";
import { auctionAttempt, auctionRevision } from "../core/procurement.js";
import { rawObservation } from "../ingest/evidence.js";
import { martSchema } from "../namespaces.js";
import { martBuild } from "./build.js";
import { martMoney, observedRate } from "./values.js";

export const openAuctionSnapshot = martSchema.table(
  "open_auction_snapshot",
  {
    buildId: bigint("build_id", { mode: "bigint" })
      .notNull()
      .references(() => martBuild.buildId),
    openAuctionSnapshotId: bigint("open_auction_snapshot_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    // 목록에만 있고 아직 상세를 따지 않은 공고도 identity 전용 attempt 행으로 먼저 만든다(ADR 0033).
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionAttempt.auctionAttemptId),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    // 근거 없는 스냅샷 행은 만들지 않는다. 이 관측이 곧 재파싱의 출발점이다.
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
    organizationId: bigint("organization_id", { mode: "bigint" }).references(() => organization.organizationId),
    // 목록이 표시한 참여 수(`BID_CNT`) 관측이다. 우리가 세지 않는다.
    bidCount: integer("bid_count"),
    sourceLastChangedAt: timestamp("source_last_changed_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    opensAt: timestamp("opens_at", { withTimezone: true }),
    announcedAt: timestamp("announced_at", { withTimezone: true }),
    baseAmount: martMoney("base_amount"),
    currency: char("currency", { length: 3 }),
    itemCodeValueId: bigint("item_code_value_id", { mode: "bigint" }).references(() => codeValue.codeValueId),
    itemLabel: text("item_label"),
    sourceStatusCodeValueId: bigint("source_status_code_value_id", { mode: "bigint" })
      .references(() => codeValue.codeValueId),
    // 아래 다섯 열은 목록이 아니라 같은 attempt의 최신 상세 해석에서 온다. 화면이 지역·품목으로
    // 거르고 하한을 보여 주려면 값이 필요한데, 요청마다 core를 lateral 조인하면 원본 점 조회가
    // 목록 경로로 새어 나온다. 그래서 빌드 시점에 한 번 조인해 싣는다(EAT-39 판정 A·B·C).
    floorRate: observedRate("floor_rate"),
    // 지역 축 둘은 같은 `mart.build.region_scheme` 안의 계층이지 두 체계가 아니다(ADR 0034, AGENTS 6).
    regionSidoCodeValueId: bigint("region_sido_code_value_id", { mode: "bigint" })
      .references(() => codeValue.codeValueId),
    regionSigunguCodeValueId: bigint("region_sigungu_code_value_id", { mode: "bigint" })
      .references(() => codeValue.codeValueId),
    // 관측된 기관 이름이지 정체성이 아니다. `organization.canonical_name`이 null인 동안 화면이
    // 기관을 부를 수 있게 하는 표시값이며 조직 해소는 여전히 code value가 한다(AGENTS 2).
    organizationLabel: text("organization_label"),
    // 위 값들을 어느 해석에서 읽었는가. 없으면 이 행의 상세 파생 열을 원본에서 재현할 수 없다.
    termsRevisionId: bigint("terms_revision_id", { mode: "bigint" })
      .references(() => auctionRevision.auctionRevisionId),
  },
  (table) => [
    unique("open_auction_snapshot_observation_grain_key")
      .on(table.buildId, table.auctionAttemptId, table.observedAt)
      .nullsNotDistinct(),
    index("open_auction_snapshot_build_closes_idx").on(table.buildId, table.closesAt, table.auctionAttemptId),
    // 참여 수 추이는 활성 build 하나를 넘어 `retain_until` 안의 모든 build를 읽는다.
    index("open_auction_snapshot_attempt_observed_idx").on(table.auctionAttemptId, table.observedAt.desc()),
    // 오늘 화면의 지역·품목 필터는 활성 build 하나 안에서만 거른다.
    index("open_auction_snapshot_build_region_sido_idx").on(table.buildId, table.regionSidoCodeValueId),
    index("open_auction_snapshot_build_item_label_idx").on(table.buildId, table.itemLabel),
    check(
      "open_auction_snapshot_currency_required_with_amount",
      sql`${table.baseAmount} is null or ${table.currency} is not null`,
    ),
    check(
      "open_auction_snapshot_bid_count_nonnegative",
      sql`${table.bidCount} is null or ${table.bidCount} >= 0`,
    ),
    // 상세에서 온 값이 계보 없이 앉으면 그 값을 어느 해석에서 읽었는지 사후에 알 수 없다(AGENTS 7).
    // 기관 라벨은 이 목록에 없다. 조직 코드에 매달린 관측이라 이 공고의 revision에서 오지 않는다.
    check(
      "open_auction_snapshot_terms_lineage_required",
      sql`${table.termsRevisionId} is not null
        or (${table.floorRate} is null and ${table.itemLabel} is null
          and ${table.regionSidoCodeValueId} is null
          and ${table.regionSigunguCodeValueId} is null)`,
    ),
  ],
);
