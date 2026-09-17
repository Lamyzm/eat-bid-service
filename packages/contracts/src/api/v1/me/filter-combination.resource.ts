/** @module 책임: 저장된 오늘 화면 조건 한 벌(이름과 필터 atom)과 그 상한을 공개 표현으로 소유한다. */
import { z } from "zod";

import { canonicalMoneyAmountSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { AUCTION_ITEM_ATOMS, auctionItemAtomSchema } from "../../../values/auction-item";
import { itemsFilterSchema, regionUnknownFilterSchema, sigunguFilterSchema } from "../auctions/list-open-auctions.query";

/**
 * 워크스페이스당 저장할 수 있는 조합 수다. **응답 배열 상한과 저장 command가 이 상수 하나를 함께 쓴다.**
 *
 * 나눠 적으면 상한을 넘긴 저장이 성공하고 그다음 조회가 자기 응답 검증에서 깨진다. 그때 사용자는
 * 정상 상태를 아예 못 읽게 된다 — `maxRegisteredBusinesses`에서 이미 한 번 겪은 함정이다.
 */
export const maxFilterCombinations = 5;

/**
 * 저장되는 것은 **필터 atom 한 벌**이다. 건수·라벨·묶음 이름은 없다 — 셋 다 파생값이라 저장하면 다음 날
 * 거짓말을 한다.
 *
 * 목록 query와 같은 atom을 쓴다. 갈리면 저장한 조건과 그 조건을 눌렀을 때의 목록이 서로 다른 집합을
 * 말하게 된다. 날짜 축(`closesOn`·`announcedOn`)은 넣지 않는다 — 오늘 저장한 `9월 15일`은 내일 지난
 * 날짜라 조합이 가리키는 판이 사라진다.
 */
export const filterCombinationFilterSchema = z.strictObject({
  sido: positiveBigintTextSchema.nullable(),
  sigungu: z.array(positiveBigintTextSchema).max(31).nullable(),
  // 품목은 원자 코드다. 저장도 표시도 원자로만 하며 묶음 이름은 여기 들어오지 않는다(EAT-230).
  items: z.array(auctionItemAtomSchema).max(AUCTION_ITEM_ATOMS.length).nullable(),
  /**
   * 공고지역을 관측하지 못한 행까지 셀지다. 지역 축과 같이 저장한다 — 이 값이 지역 축의 모집단을 바꾸므로
   * 빠뜨리면 같은 이름의 프리셋이 저장할 때와 불러올 때 다른 집합을 센다(EAT-267).
   *
   * 목록 query와 같은 어휘(`"include"` 또는 없음)를 쓴다. 여기서만 boolean으로 말하면 같은 사실을 두 가지
   * 말로 적게 되고, 한쪽 뜻이 바뀌는 날 둘이 갈린다(AGENTS 16).
   */
  regionUnknown: z.literal("include").nullable(),
  baseAmountMin: canonicalMoneyAmountSchema.nullable(),
  baseAmountMax: canonicalMoneyAmountSchema.nullable(),
}).meta({ id: "FilterCombinationFilter" });

export const filterCombinationSchema = z.strictObject({
  filterCombinationId: positiveBigintTextSchema,
  // 사용자가 정한 그대로다. 우리가 다듬지 않는다.
  name: z.string().min(1).max(40),
  filter: filterCombinationFilterSchema,
  createdAt: instantTextSchema,
}).meta({ id: "FilterCombination" });

/**
 * 저장 command가 받는 것이다. 조회 응답과 `pick`으로 잇지 않는다 — command와 public response는 서로
 * 다른 계약 family라 한쪽 필드를 고치면 다른 쪽이 조용히 따라간다(AGENTS 16).
 */
export const saveFilterCombinationCommandSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  sido: positiveBigintTextSchema.optional(),
  sigungu: sigunguFilterSchema.optional(),
  items: itemsFilterSchema.optional(),
  regionUnknown: regionUnknownFilterSchema.optional(),
  baseAmountMin: canonicalMoneyAmountSchema.optional(),
  baseAmountMax: canonicalMoneyAmountSchema.optional(),
}).meta({ id: "SaveFilterCombinationCommand" });

/**
 * 기본 조합의 이름표다. **화면 문구가 아니라 어느 이동인지를 가리키는 열쇠다.**
 *
 * 문구를 계약에 싣지 않는 이유가 둘이다. `오늘 김해`의 `김해`는 사장님 것이지 모두의 것이 아니고, 지역
 * 라벨은 아직 관측되지 않아(EAT-100) 계약이 지어낼 수 없다. 화면이 자기 어휘로 부른다(AGENTS 21).
 */
export const defaultCombinationKeySchema = z.enum([
  // 지역 말고 다 푼 수. 조건을 좁힌 채로도 내 지역의 판이 얼마나 큰지 보인다.
  "regionAll",
  // 내 지역에서 오늘 마감하는 수.
  "regionClosingToday",
  // 지금 조건에서 아직 아무도 안 들어온 판.
  "noBids",
  // 지금 조건에 품목을 관측하지 못한 행까지 더한 수. 품목 축을 걸지 않았으면 지금 조건과 같다.
  "itemUnknownIncluded",
]).meta({ id: "DefaultCombinationKey" });

export const defaultCombinationCountSchema = z.strictObject({
  key: defaultCombinationKeySchema,
  count: nonNegativeCountSchema,
}).meta({ id: "DefaultCombinationCount" });

export const savedCombinationCountSchema = z.strictObject({
  filterCombinationId: positiveBigintTextSchema,
  count: nonNegativeCountSchema,
}).meta({ id: "SavedCombinationCount" });

export type FilterCombination = z.infer<typeof filterCombinationSchema>;
export type FilterCombinationFilter = z.infer<typeof filterCombinationFilterSchema>;
export type SaveFilterCombinationCommand = z.input<typeof saveFilterCombinationCommandSchema>;
export type SaveFilterCombinationCommandInput = z.output<typeof saveFilterCombinationCommandSchema>;
export type DefaultCombinationKey = z.infer<typeof defaultCombinationKeySchema>;
export type DefaultCombinationCount = z.infer<typeof defaultCombinationCountSchema>;
export type SavedCombinationCount = z.infer<typeof savedCombinationCountSchema>;
