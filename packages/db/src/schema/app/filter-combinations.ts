/**
 * @module 책임: 사장님이 이름 붙여 저장한 오늘 화면 조건 한 벌을 사용자 작성 상태로 소유한다.
 *
 * 저장하는 것은 **이름 하나와 필터 atom 한 벌**이다. 건수·라벨·묶음 이름은 저장하지 않는다. 셋 다
 * 파생값이라 저장하면 다음 날 거짓말을 한다 — 어제 37건이던 조합이 오늘도 37건이라고 적혀 있게 된다.
 *
 * 기본 넷(`오늘 내 지역`·`내 지역 전부`·`참여 0곳`·`품목 미상 포함`)은 여기 없다. 사용자의 기본
 * 필터에서 매번 파생하므로 저장하면 지역을 바꿔도 옛 지역으로 남는다(EAT-208).
 *
 * grain은 워크스페이스다. 저장하는 atom(지역·품목·금액)에 사업자별로 갈릴 것이 하나도 없어 사업자별로
 * 나누면 같은 조합이 사업자 수만큼 복제되기만 한다. 관심 지역(`workspace_region_preference`)이 같은
 * 이유로 워크스페이스 grain이다.
 */
import { sql } from "drizzle-orm";
import { bigint, check, numeric, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { codeValue } from "../core/codes.js";
import { appSchema } from "../namespaces.js";
import { principal } from "./principals.js";
import { workspace } from "./workspaces.js";

/**
 * 워크스페이스당 저장할 수 있는 조합 수다. **응답 배열 상한과 저장 command가 이 상수 하나를 함께 쓴다.**
 *
 * 나눠 적으면 상한을 넘긴 저장이 성공하고 그다음 조회가 자기 응답 검증에서 깨진다. 그때 사용자는
 * 정상 상태를 아예 못 읽게 된다 — `maxRegisteredBusinesses`에서 이미 한 번 겪은 함정이다.
 */
export const MAX_FILTER_COMBINATIONS = 5;

export const workspaceFilterCombination = appSchema.table(
  "workspace_filter_combination",
  {
    filterCombinationId: bigint("filter_combination_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    workspaceId: bigint("workspace_id", { mode: "bigint" })
      .notNull()
      .references(() => workspace.workspaceId),
    // 사용자가 정한 그대로 쓴다. 우리가 다듬지 않으며 이 문자열은 표시값이지 식별자가 아니다(AGENTS 2).
    name: text("name").notNull(),
    /**
     * 공고지역 시도 하나다. 시군구는 이 시도 안에서만 좁히므로 자식 표가 이 값에 매달린다. 라벨이 아니라
     * code value id로 참조하며(AGENTS 2·6), 어느 체계의 코드인지는 FK로 표현할 수 없어 저장 command가
     * 같은 트랜잭션에서 판정한다(`workspace_region_preference_area`와 같은 이유).
     */
    sidoCodeValueId: bigint("sido_code_value_id", { mode: "bigint" }).references(() => codeValue.codeValueId),
    // 통화는 계약이 KRW 하나라 금액만 저장한다. 소수 둘째 자리는 원천 기초금액의 정밀도 그대로다.
    baseAmountMin: numeric("base_amount_min", { precision: 18, scale: 2 }),
    baseAmountMax: numeric("base_amount_max", { precision: 18, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByPrincipalId: bigint("created_by_principal_id", { mode: "bigint" })
      .notNull()
      .references(() => principal.principalId),
  },
  (table) => [
    // 같은 이름 둘을 막는다. 건수가 같은 두 조합이 서로 다른 이름으로 서 있으면 같은 조건에 두 이름을
    // 붙인 것이고, 이름이 같으면 사용자가 어느 쪽을 누르는지 알 수 없다.
    uniqueIndex("workspace_filter_combination_name_key").on(table.workspaceId, table.name),
    check("workspace_filter_combination_name_present", sql`length(btrim(${table.name})) > 0`),
    // 뒤집힌 금액 구간은 언제나 0건이라 조건이 아니라 오타다. 저장 자리에서 막는다.
    check(
      "workspace_filter_combination_amount_order",
      sql`${table.baseAmountMin} is null or ${table.baseAmountMax} is null
        or ${table.baseAmountMin} <= ${table.baseAmountMax}`,
    ),
  ],
);

/**
 * 조합이 고른 시군구다. 시도가 없으면 시군구도 있을 수 없다 — 어느 시도 안의 시군구인지 말하지 않는
 * 조건이기 때문이다. 그 불변식은 저장 command가 지키며, 여기서는 같은 코드를 두 번 고를 수 없다는
 * grain만 키로 표현한다.
 */
export const workspaceFilterCombinationSigungu = appSchema.table(
  "workspace_filter_combination_sigungu",
  {
    filterCombinationId: bigint("filter_combination_id", { mode: "bigint" })
      .notNull()
      .references(() => workspaceFilterCombination.filterCombinationId, { onDelete: "cascade" }),
    codeValueId: bigint("code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
  },
  (table) => [primaryKey({ columns: [table.filterCombinationId, table.codeValueId] })],
);

/**
 * 조합이 고른 품목 원자다. `eatbid:auction-item`의 code value를 가리키며 라벨 문자열을 저장하지 않는다
 * (AGENTS 2, EAT-230). 라벨 조각으로 저장하던 표를 코드 참조로 바꿨고, 그때 운영에 저장된 행은 0이었다
 * (2026-09-16 실측)라 데이터 이전 없이 열을 바꿨다.
 *
 * **묶음 이름(`축산`)은 저장하지 않는다.** 묶음을 저장하는 순간 그 정의를 우리가 소유하게 되고, 원천이
 * 묶음의 내용을 바꿔도 저장된 정의가 그대로 남는다. 저장도 표시도 원자로만 한다.
 */
export const workspaceFilterCombinationItem = appSchema.table(
  "workspace_filter_combination_item",
  {
    filterCombinationId: bigint("filter_combination_id", { mode: "bigint" })
      .notNull()
      .references(() => workspaceFilterCombination.filterCombinationId, { onDelete: "cascade" }),
    itemCodeValueId: bigint("item_code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
  },
  (table) => [primaryKey({ columns: [table.filterCombinationId, table.itemCodeValueId] })],
);
