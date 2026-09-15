/** @module 책임: 제품 코드가 참조하는 코드 체계 이름을 계약 층에서 한 번만 선언한다. */

// 체계 이름을 화면·서버가 각자 문자열로 적으면 개편 때 한쪽만 바뀌고 두 층이 서로 다른 체계를 같은
// 것으로 믿는다(AGENTS 6). 값의 권위는 `packages/db/src/seeds/code-schemes.ts`이며 여기는 그 이름을
// TypeScript 소비자에게 여는 유일한 참조점이다. `pnpm lint:region-vocabulary`가 둘의 일치를 지킨다.
export const CODE_SCHEME_NAMES = {
  /** 행정안전부 법정동코드. 지역 canonical은 이것 하나다(ADR 0035 결정 1). */
  administrativeRegion: "mois:administrative-region",
  /** eaT 공고지역 시도·시군구. 관측된 코드일 뿐 canonical이 아니며 매핑을 거쳐야 한다. */
  auctionLocationSido: "eat:auction-location-sido",
  auctionLocationSigungu: "eat:auction-location-sigungu",
  /** eaT 참가제한지역. 라벨을 주는 유일한 eaT 지역 축이다. */
  eligibilityArea: "eat:eligibility-area",
  /** eaT 명단의 철회 여부. 낙찰 상태와 별도로 해석한다. */
  withdrawalFlag: "eat:withdrawal-flag",
  /**
   * 공고 품목 원자. 여기만 접두사가 `eatbid:`인 이유는 eaT가 품목을 라벨 문자열로만 주고 코드를 주지
   * 않아 코드를 발급하는 주체가 우리이기 때문이다. 용어는 eaT의 것이고 우리가 만든 것은 식별자뿐이다.
   */
  auctionItem: "eatbid:auction-item",
} as const;

export type CodeSchemeName = (typeof CODE_SCHEME_NAMES)[keyof typeof CODE_SCHEME_NAMES];
