/** @module 책임: 분석 조건 막대가 고를 수 있는 지역·기관·품목과 그 건수의 공개 V1 응답 봉투를 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { AUCTION_ITEM_ATOMS, auctionItemAtomSchema } from "../../../values/auction-item";
import { codeReferenceSchema } from "../../../values/code-reference";
import { martBuildLineageSchema } from "../../../values/mart-lineage";

/**
 * 지역 하나와 그 건수다. **지역 축을 푼 집합**에서 세므로 "이 지역으로 바꾸면 몇 건이 되나"를 말한다.
 * 라벨은 관측이라 없을 수 있고, 이름이 없다고 항목을 빼지 않는다 — 빼면 그 지역의 회차가 조건에서
 * 사라진다(AGENTS 3).
 */
export const analysisRegionCountSchema = z.strictObject({
  region: codeReferenceSchema,
  count: nonNegativeCountSchema,
}).meta({ id: "AnalysisRegionCount" });

/**
 * 겹쳐 찍을 수 있는 기관 하나다. 같은 이름의 학교가 여러 시군구에 있으므로 어느 지역인지를 함께
 * 싣는다 — 이름만 주면 사용자가 다른 학교를 고른 것을 알 수 없다(AGENTS 2·5).
 */
export const analysisOrganizationOptionSchema = z.strictObject({
  organizationId: positiveBigintTextSchema,
  name: z.string().min(1).max(256).nullable(),
  region: codeReferenceSchema.nullable(),
  count: nonNegativeCountSchema,
}).meta({ id: "AnalysisOrganizationOption" });

/** 품목 원자 하나와 그 건수다. 한 회차가 원자 여럿을 가지므로 합은 전체보다 클 수 있다. */
export const analysisItemCountSchema = z.strictObject({
  item: auctionItemAtomSchema,
  count: nonNegativeCountSchema,
}).meta({ id: "AnalysisItemCount" });

/**
 * 지금 고른 비교 지역이다. 화면이 여닫이에 이름을 적고 어느 시도를 펼쳐 둘지 정하는 데 쓴다.
 *
 * 시군구를 고른 채 화면을 다시 열면 그 이름도 부모 시도도 화면에는 없다 — 사전은 요청한 시도의
 * 시군구만 싣기 때문이다. 그 둘을 서버가 함께 주지 않으면 화면이 코드값을 이름 자리에 적게 된다.
 * 전국이면 null이다.
 */
export const analysisSelectedRegionSchema = z.strictObject({
  region: codeReferenceSchema,
  /** 시군구를 골랐을 때 그 시군구가 속한 시도다. 시도를 골랐으면 null이다. */
  parentSidoCodeValueId: positiveBigintTextSchema.nullable(),
}).meta({ id: "AnalysisSelectedRegion" });

export const analysisConditionOptionsV1ResponseSchema = z.strictObject({
  selectedRegion: analysisSelectedRegionSchema.nullable(),
  /**
   * 활성 build에서 회차가 관측된 시도다. 사전의 시도 전부가 아니라 **고르면 실제로 무언가 나오는**
   * 시도만 선다 — 0건인 지역을 고르게 두면 사용자가 헛걸음한다.
   */
  sidoCounts: z.array(analysisRegionCountSchema).max(64),
  /** `sido`를 준 요청에서만 그 시도 안의 시군구다. 없으면 빈 배열이며 전국 시군구를 한 번에 세우지 않는다. */
  sigunguCounts: z.array(analysisRegionCountSchema).max(256),
  /** 지역 축을 푼 집합에서 공고지역을 번역하지 못한 회차 수다. 그 회차는 어느 지역에도 들지 않는다. */
  regionUnobservedCount: nonNegativeCountSchema,
  /** 원자 여덟을 어휘 순서로 전부 싣고 0도 싣는다. 0이 사라지면 그 품목이 없는지 어휘 밖인지 알 수 없다. */
  itemCounts: z.array(analysisItemCountSchema).length(AUCTION_ITEM_ATOMS.length),
  /** 품목 축을 푼 집합에서 공고가 품목을 말하지 않은 회차 수다. `품목 미확인`의 건수다(PDR-0007). */
  itemUnknownCount: nonNegativeCountSchema,
  /** 고른 비교 지역 안에서 회차가 있는 기관이다. 검색어가 있으면 그 안에서 좁힌다. */
  organizations: z.array(analysisOrganizationOptionSchema).max(50),
  /** 상한에 걸려 잘렸다는 사실이다. 잘라 놓고 전부인 척하지 않는다 — 화면은 검색어를 더 적으라고 말한다. */
  organizationsTruncated: z.boolean(),
  meta: z.strictObject({
    /** 이 건수를 만든 mart build다. 건수도 지표이므로 어느 실행에서 나왔는지 없이 내보내지 않는다(AGENTS 7). */
    observationBuild: martBuildLineageSchema,
  }),
}).meta({ id: "EatbidApiV1AnalysisConditionOptions" });

export type AnalysisConditionOptionsV1Response = z.infer<typeof analysisConditionOptionsV1ResponseSchema>;
export type AnalysisRegionCount = z.infer<typeof analysisRegionCountSchema>;
export type AnalysisSelectedRegion = z.infer<typeof analysisSelectedRegionSchema>;
export type AnalysisOrganizationOption = z.infer<typeof analysisOrganizationOptionSchema>;
export type AnalysisItemCount = z.infer<typeof analysisItemCountSchema>;
