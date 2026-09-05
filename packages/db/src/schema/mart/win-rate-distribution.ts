/**
 * @module 책임: 호가창이 읽는 월별 낙찰 사정률 분포 `mart.win_rate_distribution_monthly`를 소유한다.
 *
 * 회차 요약과 달리 grain이 (모집단 × 코호트 × 달 × 구간)이라 함께 바뀌지 않으므로 별도 module이다.
 */
import { bigint, check, date, unique, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { codeValue } from "../core/codes.js";
import { organization } from "../core/organizations.js";
import { martSchema } from "../namespaces.js";
import { martBuild } from "./build.js";
import { assessmentRate, observedRate } from "./values.js";

export const distributionScopes = ["national", "province", "district", "organization"] as const;

/**
 * 구간은 반개구간 `[bin_lower, bin_lower + bin_width)`다. 사정률이 `numeric(15,3)`이라
 * `floor(x * 100) / 100`은 정확 연산이고 부동소수를 거치지 않는다.
 *
 * 달 경계는 개찰 시각의 KST 달이다. 낙찰률은 개찰의 결과이므로 공고가 아니라 개찰이 속한 달에 센다.
 *
 * 네 모집단이 같은 회차를 각각 한 번씩 세므로 모집단은 겹친다. 기간 조회는 월 행을 합산한다.
 */
export const winRateDistributionMonthly = martSchema.table(
  "win_rate_distribution_monthly",
  {
    buildId: bigint("build_id", { mode: "bigint" })
      .notNull()
      .references(() => martBuild.buildId),
    winRateDistributionId: bigint("win_rate_distribution_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    scope: varchar("scope", { length: 16, enum: distributionScopes }).notNull(),
    // 어떤 코드 체계인지는 열이 아니라 `mart.build.region_scheme`이 기록한다(AGENTS 6, ADR 0034).
    regionCodeValueId: bigint("region_code_value_id", { mode: "bigint" }).references(() => codeValue.codeValueId),
    organizationId: bigint("organization_id", { mode: "bigint" }).references(() => organization.organizationId),
    itemCodeValueId: bigint("item_code_value_id", { mode: "bigint" }).references(() => codeValue.codeValueId),
    // 코호트 키다. 하한율 90과 88은 서로 다른 축이라 한 분포에 섞지 않는다.
    floorRate: observedRate("floor_rate").notNull(),
    // 코호트 키다. 단가입찰(`013`·`014`)의 사정률을 `003`과 섞지 않는다.
    awardMethodCodeValueId: bigint("award_method_code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
    monthKst: date("month_kst").notNull(),
    binLower: assessmentRate("bin_lower").notNull(),
    // 폭을 바꾸면 `mart.build.calc_version`이 바뀐다. 같은 build 안에서는 상수다.
    binWidth: assessmentRate("bin_width").notNull(),
    attemptCount: bigint("attempt_count", { mode: "bigint" }).notNull(),
  },
  (table) => [
    unique("win_rate_distribution_monthly_cohort_key")
      .on(
        table.buildId,
        table.scope,
        table.regionCodeValueId,
        table.organizationId,
        table.itemCodeValueId,
        table.floorRate,
        table.awardMethodCodeValueId,
        table.monthKst,
        table.binLower,
      )
      .nullsNotDistinct(),
    check(
      "win_rate_distribution_monthly_scope_allowed",
      sql`${table.scope} in ('national', 'province', 'district', 'organization')`,
    ),
    // scope가 요구하는 축이 비어 있으면 그 행은 어느 모집단의 것인지 말할 수 없다.
    check(
      "win_rate_distribution_monthly_scope_axis_required",
      sql`(${table.scope} = 'national' and ${table.regionCodeValueId} is null and ${table.organizationId} is null)
        or (${table.scope} in ('province', 'district')
            and ${table.regionCodeValueId} is not null and ${table.organizationId} is null)
        or (${table.scope} = 'organization'
            and ${table.regionCodeValueId} is null and ${table.organizationId} is not null)`,
    ),
    check("win_rate_distribution_monthly_bin_width_positive", sql`${table.binWidth} > 0`),
    check("win_rate_distribution_monthly_attempt_count_positive", sql`${table.attemptCount} > 0`),
  ],
);
