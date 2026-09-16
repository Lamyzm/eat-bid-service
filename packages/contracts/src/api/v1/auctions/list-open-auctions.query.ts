/** @module 책임: 열린 공고 목록 조회 query의 필터 atom과 그 조합 계약을 소유한다. */
import { z } from "zod";

import { kstDateTextSchema } from "../../../atoms/calendar";
import { canonicalMoneyAmountSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { AUCTION_ITEM_ATOMS, auctionItemAtomSchema } from "../../../values/auction-item";
import { maxEligibilityAreaSelection } from "../../../values/eligibility-area";

// `closed`를 지원할 계획이 없어서가 아니라, 지원하지 않는 값을 계약에 적어 두면 화면이 그 값을 보낼 수
// 있기 때문에 literal 하나다. 필요해지면 enum으로 넓힌다(비파괴적).
export const openAuctionStateSchema = z.literal("open").meta({ id: "OpenAuctionState" });

// query string에는 값 봉투(`{value, unit}`)를 실을 수 없으므로 이름이 단위를 소유한다(AGENTS 15).
// 상한 720시간은 30일이며 열린 공고의 최대 마감 창을 넘는 값이다.
export const closesWithinHoursSchema = z.coerce.number().int().min(1).max(720);

// 첫 페이지 상한 100은 pages-endpoints-load.md §2의 값이다. 기본 50은 1440에서 스크롤 한 번으로
// 닿는 행 수이며 응답 크기를 절반으로 줄인다.
export const DEFAULT_OPEN_AUCTION_LIMIT = 50;

/**
 * 한 응답에 실을 수 있는 최대 행 수다. **query와 응답이 이 상수 하나를 함께 쓴다.**
 *
 * 나눠 적었다가 실제로 깨졌다. query만 200으로 넓히고 응답 배열이 100에 머물러 `limit=200`이
 * 400도 아니고 500이 됐다. 서버가 허용한 요청의 응답이 자기 계약에서 거부된 것이다.
 *
 * 200인 근거는 성수기 실측이다. 시도 하나가 1,932행이라 한 응답에 다 실을 수 없고, 사용자의 기본
 * 조건(김해 축산)은 성수기에도 62행이라 한 판에 들어간다.
 */
export const MAX_OPEN_AUCTION_LIMIT = 200;

/**
 * 참가제한지역 필터다. query string은 값 하나와 값 여럿을 구분하지 못하므로(`?eligibilityArea=1`은
 * 문자열, `?eligibilityArea=1&eligibilityArea=2`는 배열) 파싱 직전에 한 번만 배열로 편다. 이 정규화를
 * 화면과 서버가 각자 하면 코드 하나를 고른 사용자와 둘을 고른 사용자가 서로 다른 경로를 타게 된다.
 */
export const eligibilityAreaFilterSchema = z.preprocess(
  (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
  z.array(positiveBigintTextSchema).min(1).max(maxEligibilityAreaSelection),
);

/**
 * 시군구 필터다. `eligibilityArea`와 같은 이유로 파싱 직전에 한 번만 배열로 편다 — query string이
 * 값 하나와 값 여럿을 구분하지 못하기 때문이다.
 *
 * 상한 31은 시도 하나가 가진 시군구의 최대치다(경기 31개). 그보다 많이 고를 수 있으면 시도 하나라는
 * 제약이 배열 길이로 새어 나간다.
 */
export const sigunguFilterSchema = z.preprocess(
  (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
  z.array(positiveBigintTextSchema).min(1).max(31),
);

/**
 * 품목 필터다. **원자 배열이고 OR이다.** 값은 `eatbid:auction-item` 체계의 코드이며 원자 하나라도 행에
 * 붙어 있으면 걸린다 — 원천 라벨이 `육류 , 가금류`처럼 합성이라 mart가 행마다 원자 여러 개를 다리표로
 * 갖고, 서버는 라벨 문자열이 아니라 그 코드로 조인한다(AGENTS 2, EAT-230).
 *
 * 묶음 이름(`축산`)은 받지 않는다. 묶음을 필터 값으로 받는 순간 그 정의를 우리가 소유하게 되므로
 * 원자로만 거른다(2026-09-13 결정). 어휘 밖 문자열은 400이다 — 예전처럼 부분일치로 받으면 `축`이
 * `축산물`과 `축제`를 함께 잡는 식으로 필터가 검색이 된다.
 *
 * 상한은 원자 수 8이다. 그보다 많이 고를 수 있으면 같은 원자를 되풀이 보낸 것뿐이다.
 */
export const itemsFilterSchema = z.preprocess(
  (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
  z.array(auctionItemAtomSchema).min(1).max(AUCTION_ITEM_ATOMS.length),
);

/**
 * 지역은 **공고지역**이고 활성 스냅샷 build가 선언한 체계
 * (`meta.openAuctionSnapshotBuild.regionScheme`)의 code value id다. 라벨·이름으로는 거르지 않는다
 * (AGENTS 2·6).
 *
 * **축이 2단이며 `시도 하나 + 그 안의 시군구 여럿`이다.** 하나로 합쳐 `시도든 시군구든 그 id를 가진
 * 행`으로 받던 것을 쪼갠 이유는 크기다. 2026-06-19 성수기 실측으로 시도 하나가 **1,932행**이라
 * 사용자가 전국을 막기로 한 결정이 시도 여럿으로 우회된다. `sido`를 배열로 받지 않아 타입이 그
 * 제약을 말하고, `sigungu`는 그 `sido` 안에 있어야 한다 — 아니면 400이다.
 *
 * 짝 검증은 지금 **활성 build에서 관측된 짝**으로만 한다. 스냅샷 행마다 두 축이 함께 있어 실제로 없는
 * 조합은 걸러지지만 그 build에 안 나타난 조합은 못 가린다. 계층 자체의 검증은 행안부 매핑(EAT-100)이
 * 들어와야 한다.
 *
 * `eligibilityArea`는 **참가제한지역**이며 위와 다른 체계다. 학교가 어디 있는지가 아니라 공고가 누구의
 * 참가를 허용하는지를 보는 축이라, 두 필터는 서로를 대체하지 않고 같은 요청에서 함께 걸릴 수 있다
 * (PDR-0001, ADR 0048). 고른 코드 하나가 만드는 매칭 집합은 `{그 코드, 그 코드의 시도 전체 코드}`이며
 * 그 확장은 서버가 한다 — 화면이 전국을 받아 client에서 자르지 않는다.
 *
 * 품목은 아직 code scheme이 없어 관측 라벨 완전일치다(EAT-39 판정 B). 조각 여럿을 term으로 바꾸는
 * 것은 EAT-66이 소유하므로 여기서 배열로 넓히지 않는다.
 *
 * `closesOn`·`announcedOn`은 **KST 달력일**이고 `closesWithinHours`는 **시간 창**이다. 이름이 단위를
 * 소유하며(AGENTS 15) 섞어 쓸 수 없다 — 15시에 `24시간 안`을 물으면 내일 14시가 함께 걸리므로
 * 달력일을 대신하지 못한다. `announcedOn`은 상세에서 온 게시일을 보며 목록 관측에는 그 값이 없다.
 */
/**
 * 참여 축이다. **값이 `none` 하나뿐인 enum인 이유는 이것이 수 비교가 아니라 상태이기 때문이다.**
 *
 * `bidCountMax=0`으로 두면 참여 수를 관측하지 못한 행(`null`)이 어느 쪽인지 말하지 않는다. 아무도 안
 * 들어온 판과 못 센 판은 사용자가 할 일이 다르므로(AGENTS 3) 이 축은 관측된 0만 고른다.
 */
export const bidStateFilterSchema = z.literal("none");

/**
 * 품목 미관측을 함께 볼지다. 품목 축을 걸면 라벨을 관측하지 못한 행이 조용히 빠지는데, 그 행은 낼 수
 * 없는 공고가 아니라 우리가 아직 못 본 공고다. 이 값이 있으면 미관측도 함께 낸다.
 *
 * 품목 축이 없으면 아무 일도 하지 않는다 — 이미 전부 보고 있기 때문이다.
 */
export const itemUnknownFilterSchema = z.literal("include");

/**
 * 지역 미관측을 함께 볼지다. 시도 축을 걸면 공고지역을 관측하지 못한 행이 조용히 빠지는데, 그 행은 다른
 * 지역의 공고가 아니라 어디인지 아직 못 본 공고다. 이 값이 있으면 미관측도 함께 낸다. 시도 축이 없으면
 * 아무 일도 하지 않는다 — 이미 전부 보고 있기 때문이다(EAT-260).
 */
export const regionUnknownFilterSchema = z.literal("include");

/**
 * 검색어다. **제목·기관 이름·공고번호 안의 부분일치**이며 지금 걸린 다른 조건 안에서만 찾는다.
 *
 * 목록은 200건 상한이고 더보기를 두지 않으므로 상한 밖 행에 닿는 길이 이것뿐이다(EAT-206 결정,
 * EAT-247). 술어는 품목 조각과 같은 `strpos`다 — 사용자 입력에 `like` 메타문자를 열지 않는다.
 * 양끝 공백은 뜻이 없어 걷어 내고, 64자는 관측된 가장 긴 제목의 절반쯤이라 문장이 아니라 낱말을
 * 받는 크기다. 전문 검색·형태소 분석은 만들지 않는다(AGENTS 11).
 */
export const searchTextSchema = z.string().trim().min(1).max(64);

export const openAuctionListQuerySchema = z.strictObject({
  state: openAuctionStateSchema.default("open"),
  sido: positiveBigintTextSchema.optional(),
  sigungu: sigunguFilterSchema.optional(),
  regionUnknown: regionUnknownFilterSchema.optional(),
  eligibilityArea: eligibilityAreaFilterSchema.optional(),
  items: itemsFilterSchema.optional(),
  itemUnknown: itemUnknownFilterSchema.optional(),
  q: searchTextSchema.optional(),
  bidState: bidStateFilterSchema.optional(),
  closesWithinHours: closesWithinHoursSchema.optional(),
  closesOn: kstDateTextSchema.optional(),
  announcedOn: kstDateTextSchema.optional(),
  // 통화는 계약이 KRW 하나이므로 봉투 없이 금액 문자열만 받고 서버가 numeric 비교로 닫는다.
  baseAmountMin: canonicalMoneyAmountSchema.optional(),
  baseAmountMax: canonicalMoneyAmountSchema.optional(),
  cursor: positiveBigintTextSchema.optional(),
  // 상한 200은 성수기 실측에서 나왔다. 시도 하나가 1,932행이라 한 응답에 다 실을 수 없고, 사용자의
  // 기본 조건(김해 축산)은 성수기에도 62행이라 한 판에 들어간다. 더보기를 두지 않으므로 화면은 넘는
  // 수를 `N건 중 200건`으로 적고 날짜·지역·검색이 좁히는 길이 된다.
  limit: z.coerce.number().int().min(1).max(MAX_OPEN_AUCTION_LIMIT).default(DEFAULT_OPEN_AUCTION_LIMIT),
});

export type OpenAuctionListQuery = z.output<typeof openAuctionListQuerySchema>;
