/** @module 책임: 지역 선택 미리보기의 공개 V1 응답 봉투와 오늘·성수기 두 관측을 계보와 함께 싣는 meta 계약을 소유한다. */
import { z } from "zod";

import { kstDateTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { instantTextSchema } from "../../../atoms/instant";
import { martBuildLineageSchema } from "../../../values/mart-lineage";

/**
 * 지금 열린 공고에 그 선택을 적용한 결과다. 셋을 한 숫자로 합치지 않는다 —
 * `matchedCount`는 고른 지역이 실제로 잡은 수, `unobservedCount`는 제한지역이 관측되지 않아 버리지 않고
 * 남긴 수, `nationwideCount`는 아무 조건도 걸지 않았을 때의 수다. 화면이 "404건이 9건이 된다"고 말하려면
 * 분모와 분자를 모두 알아야 하고, 미관측을 매칭에 섞으면 그 문장이 거짓이 된다(AGENTS 3).
 */
export const regionCoverageTodaySchema = z.strictObject({
  matchedCount: nonNegativeCountSchema,
  unobservedCount: nonNegativeCountSchema,
  nationwideCount: nonNegativeCountSchema,
}).meta({ id: "RegionCoverageToday" });

/** 그 하루에 마감이 몰린 공고 수다. 날짜는 KST 달력일이고 값은 관측된 최대 하루다. */
export const regionCoveragePeakDaySchema = z.strictObject({
  date: kstDateTextSchema,
  count: nonNegativeCountSchema,
}).meta({ id: "RegionCoveragePeakDay" });

/**
 * 과거 창 관측이다. 일 평균을 싣지 않는 이유는 이 제품이 매일 쓰는 도구가 아니기 때문이다. 0건인 날이
 * 3분의 2인 분포에서 평균은 성수기도 한가한 날도 말하지 못한다. 대신 **공고가 있던 날 수**와 **그중
 * 중앙값**, **하루 최대**를 함께 실어 사용자가 자기 달력에서 어느 며칠을 여는 일인지 읽게 한다.
 *
 * 표본 수와 기간을 응답이 스스로 말해야 재현된다(AGENTS 7). `windowStart`·`windowEnd`는 서버 clock이
 * 정한 실제 경계이고, 창 안에 공고가 하나도 없으면 `daysWithAuctions`가 0이며 `peakDay`는 null이다.
 */
export const regionCoverageWindowSchema = z.strictObject({
  windowStart: instantTextSchema,
  windowEnd: instantTextSchema,
  daysWithAuctions: nonNegativeCountSchema,
  medianDayCount: nonNegativeCountSchema.nullable(),
  peakDay: regionCoveragePeakDaySchema.nullable(),
}).meta({ id: "RegionCoverageWindow" });

export const regionCoverageV1ResponseSchema = z.strictObject({
  today: regionCoverageTodaySchema,
  window: regionCoverageWindowSchema,
  meta: z.strictObject({
    // "열림"은 `closesAt > asOf` 판정이라 어느 시각 기준인지를 응답이 말해야 같은 수가 다시 나온다.
    asOf: instantTextSchema,
    // 오늘 세 숫자는 활성 스냅샷 build 하나에서 오고, 과거 창은 build가 아니라 core 관측에서 온다.
    // 계보를 하나만 싣는 것은 그 차이를 지우지 않기 위해서다.
    openAuctionSnapshotBuild: martBuildLineageSchema,
  }),
}).meta({ id: "EatbidApiV1RegionCoverage" });

export type RegionCoverageToday = z.infer<typeof regionCoverageTodaySchema>;
export type RegionCoverageWindow = z.infer<typeof regionCoverageWindowSchema>;
export type RegionCoverageV1Response = z.infer<typeof regionCoverageV1ResponseSchema>;
