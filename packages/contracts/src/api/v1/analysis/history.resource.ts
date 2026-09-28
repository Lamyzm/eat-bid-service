/** @module 책임: 분석 전체 개찰 이력 표의 회차 한 줄과 페이지 고정 meta resource를 정의한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { auctionItemAtomSchema } from "../../../values/auction-item";
import { martBuildLineageSchema } from "../../../values/mart-lineage";
import { moneyWireSchema } from "../../../values/money";
import { observedBidRateWireSchema } from "../../../values/rate";

/**
 * 이력 표가 어느 집단을 읽는지다. `target`은 이 기관, `comparison`은 같은 조건의 지역·전국 전체다.
 * 두 목록은 **같은 조건**에서 범위만 다르다 — 조건을 따로 받으면 그림의 표본과 표의 행이 다른 집합이 된다.
 */
export const analysisHistoryPopulationSchema = z.enum(["target", "comparison"]);

/**
 * 개찰 회차 한 줄이다. 분석 모집단과 같은 회차만 나온다 — 낙찰 사정률이 관측된 회차다. 유찰·진행·취소는
 * 이 집합에 없고 서로 구분할 필드도 없으므로 표가 그 이름을 지어내지 않는다(analysis-common-contracts §2).
 *
 * `attemptId`·`revisionId`는 명단을 여는 열쇠다. 그림의 점이 그려진 revision의 명단을 읽어야 이 줄이
 * 말한 결과와 같은 명단이 열린다(ADR 0041 §1).
 */
export const analysisHistoryRowSchema = z.strictObject({
  attemptId: positiveBigintTextSchema,
  revisionId: positiveBigintTextSchema,
  organizationId: positiveBigintTextSchema,
  /** 관측 라벨이라 없을 수 있다. 없다고 줄을 빼지 않는다(AGENTS 3). */
  organizationName: z.string().min(1).max(256).nullable(),
  announcedAt: instantTextSchema,
  openedAt: instantTextSchema.nullable(),
  /** 품목 원자다. 공고가 품목을 말하지 않았으면 null이다 — 빈 배열로 뭉개지 않는다(PDR-0007). */
  items: z.array(auctionItemAtomSchema).max(16).nullable(),
  assessmentRate: observedBidRateWireSchema,
  /** 원천 `RNK=2` 행의 사정률이다. 낙찰보다 낮을 수 있고 그대로 싣는다. */
  secondRate: observedBidRateWireSchema.nullable(),
  /** 명단을 관측하지 못했으면 null이다. 0곳과 다른 사실이다. */
  listCount: nonNegativeCountSchema.nullable(),
  belowDayFloorCount: nonNegativeCountSchema.nullable(),
  winner: z.strictObject({
    supplierPartyId: positiveBigintTextSchema,
    name: z.string().min(1).max(512).nullable(),
  }).nullable(),
  baseAmount: moneyWireSchema,
}).meta({ id: "AnalysisHistoryRow" });

/**
 * 이력 페이지의 기준이다. 다음 페이지는 첫 응답의 `build.buildId`를 되돌려 보내 같은 build를 이어 읽는다.
 * 그 사이 활성 build가 바뀌면 409다 — 두 build의 행을 한 목록에 섞으면 같은 회차가 두 번 나오거나 빠진다.
 */
export const analysisHistoryMetaSchema = z.strictObject({
  population: analysisHistoryPopulationSchema,
  /** 이 조건·이 집단의 전체 회차 수다. 페이지로 나눠 받아도 몇 건 중 몇 건을 봤는지 말할 수 있어야 한다. */
  totalCount: nonNegativeCountSchema,
  build: martBuildLineageSchema,
}).meta({ id: "AnalysisHistoryMeta" });

export type AnalysisHistoryPopulation = z.infer<typeof analysisHistoryPopulationSchema>;
export type AnalysisHistoryRow = z.infer<typeof analysisHistoryRowSchema>;
