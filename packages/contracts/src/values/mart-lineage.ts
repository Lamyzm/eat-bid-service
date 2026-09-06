/** @module 책임: mart 파생물을 읽은 활성 build 하나의 계보와 모집단 보유율 wire value를 소유한다. */
import { z } from "zod";

import { positiveBigintTextSchema, sourceReleaseIdTextSchema } from "../atoms/identifier";
import { instantTextSchema } from "../atoms/instant";

/**
 * 모집단 보유율이다. `unknown`이 넷째 값인 이유는 지금 수집 구간에 시도 축이 없어 그 grain의 분모를
 * 낼 수 없기 때문이다. `partial`로 뭉개면 화면이 "일부 수집됨"이라고 거짓말한다(PDR-0003).
 * 코호트에 여러 행이 걸리면 가장 나쁜 값을 싣는다(`none` > `unknown` > `partial` > `complete`).
 */
export const martCoverageSchema = z.enum(["complete", "partial", "none", "unknown"])
  .meta({ id: "MartCoverage", description: "Worst population coverage verdict across the requested cohort." });

/**
 * 계보는 행이 아니라 build가 갖는다(ADR 0034). 자유 문자열 `martRelease`를 남기면 "release"라는
 * 이름의 값이 `sourceReleaseId`와 둘이 되어 어느 쪽이 권위인지 알 수 없다.
 * 활성 build가 아직 없는 상태는 오류가 아니라 계보 전체가 null인 빈 결과다.
 *
 * 회차 이력과 낙찰률 분포가 같은 계보를 응답 meta에 싣기 때문에 어느 한 mart 계약이 이것을 혼자
 * 갖지 않는다. 두 벌로 두면 한쪽만 바뀔 때 화면이 다른 계보를 같은 뜻으로 읽는다.
 */
export const martBuildLineageSchema = z.strictObject({
  buildId: positiveBigintTextSchema.nullable(),
  sourceReleaseId: sourceReleaseIdTextSchema.nullable(),
  calcVersion: z.string().min(1).max(32).nullable(),
  computedAt: instantTextSchema.nullable(),
  coverage: martCoverageSchema.nullable(),
  // 지역 축이 어떤 CodeScheme의 것인지는 build가 기록한다. 화면이 "이 분포는 eaT 공고지역 기준"이라고
  // 말할 수 있어야 행정안전부 코드로의 전환이 침묵하지 않는다(AGENTS 6).
  regionScheme: z.string().min(1).max(64).nullable(),
});

export type MartCoverage = z.infer<typeof martCoverageSchema>;
export type MartBuildLineageWire = z.infer<typeof martBuildLineageSchema>;
