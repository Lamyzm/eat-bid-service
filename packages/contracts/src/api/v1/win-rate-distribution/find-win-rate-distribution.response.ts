/** @module 책임: 낙찰률 분포 조회의 공개 V1 응답 봉투 계약을 소유한다. */
import { z } from "zod";

import {
  binBoundarySchema,
  distributionBinSchema,
  distributionMonthSchema,
  modeRangeSchema,
  winRateDistributionMetaSchema,
} from "./distribution.resource";

/**
 * `bins`는 횟수가 0보다 큰 칸만 `from` 오름차순으로 싣는다. 빈 칸까지 채우면 하한율~100 사이가
 * 1,000행이 되고 그 대부분이 0이다. 사다리의 빈 줄은 화면이 스스로 채운다.
 *
 * 상위 `bins`는 `months[].bins`의 칸별 합과 같아야 한다. 두 질의로 나눠 읽으면 서로 다른 스냅샷을
 * 볼 수 있으므로 어댑터는 한 질의로 달×칸을 읽고 합산은 application이 한다.
 *
 * 표본이 0이면 `medianBin`과 `modeRange`가 모두 null이다. 표본 없는 코호트도 200이며, 활성 build가
 * 아직 없는 상태도 오류가 아니라 계보 전부 null인 빈 결과다(ADR 0011·0034).
 */
export const winRateDistributionV1ResponseSchema = z.strictObject({
  bins: z.array(distributionBinSchema).max(4096),
  medianBin: binBoundarySchema.nullable(),
  modeRange: modeRangeSchema.nullable(),
  months: z.array(distributionMonthSchema).max(12),
  meta: winRateDistributionMetaSchema,
}).meta({ id: "EatbidApiV1WinRateDistribution" });

export type WinRateDistributionV1Response = z.infer<typeof winRateDistributionV1ResponseSchema>;
