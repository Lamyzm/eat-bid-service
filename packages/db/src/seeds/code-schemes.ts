/** @module 책임: 부트스트랩 시점에 존재해야 하는 code scheme namespace와 그 소유·버전 정책을 선언하고 멱등하게 심는다. */
import { codeScheme } from "../schema/core/codes.js";

export const builtinCodeSchemes = [
  {
    namespace: "eat:auction-location-sido",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "eat:auction-location-sigungu",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "eat:eligibility-area",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "mois:administrative-region",
    owner: "Ministry of the Interior and Safety",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "neis:school",
    owner: "Korea Education and Research Information Service",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "eat:organization",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "eat:supplier-account",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  // 아래 일곱은 eaT 상세 파서가 싣는 code scheme이다. namespace는 소스 column명(`BID_STT` 등)이
  // 아니라 의미 이름이며, column명은 관측 위치를 말하는 메타데이터로
  // `apps/dataplane/src/eatbid/source/eat/code_schemes.py`가 갖는다(AGENTS 2).
  {
    namespace: "eat:bid-status",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "eat:withdrawal-flag",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "eat:business-number",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "eat:planned-price-type",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "eat:award-method",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "eat:reserve-price-selection-flag",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  {
    namespace: "eat:attempt-status",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  // 구매기관 유형이다. eaT 공통 코드목록(BC016)에서만 관측되고 공고 응답에는 오지 않으므로
  // `core.organization.type`과는 아직 잇지 않는다 —
  // `apps/dataplane/src/eatbid/source/eat/code_schemes.py`의 `ORGANIZATION_TYPE`이 그 이유를 갖는다.
  {
    namespace: "eat:organization-type",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  // 단독입찰 처리 방법(`ds_info.SGNS_BID_PRCS_MTHD_CD`, 허용함/허용안함)이다. 참여 0곳의 뜻을 바꾸는 조건이라
  // eat-v4 상세 파서가 읽는다(EAT-249).
  {
    namespace: "eat:solo-bid-method",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  // 게시 종류(`ds_info.PBANC_CHG_GB_CD`, 000 일반공고 / 001 변경공고 / 003 재입찰)다. 재입찰의 진짜 신호이며
  // `RBID_YN`이 아니다(SOURCE-FIELDS T13). eat-v5 상세 파서가 읽는다(EAT-262).
  {
    namespace: "eat:announcement-change-kind",
    owner: "aT",
    versionPolicy: "source-managed",
    validTimePolicy: "effective-dated",
  },
  // 위 전부와 달리 이 체계만 owner가 우리다. eaT는 품목을 `MAIN_ITEMS` 라벨 문자열로만 주고 코드를
  // 주지 않으므로, 코드를 발급하고 폐기하는 주체가 우리다. 접두사를 `eat:`로 두면 aT가 코드를 준 것처럼
  // 보이므로 다른 체계와 같은 규칙(접두사 = 소유자)을 지켜 `eatbid:`로 부른다. 용어 자체는 eaT가
  // 나눈 것이라 그대로 싣고, 우리가 만든 것은 코드뿐이라는 사실만 이름이 말한다(AGENTS 2·6).
  {
    namespace: "eatbid:auction-item",
    owner: "eatbid",
    versionPolicy: "product-managed",
    validTimePolicy: "effective-dated",
  },
] as const;

/**
 * 심은 namespace 중 하나여야 한다. 품목 원자 시드가 이 이름으로 체계 행을 골라 심으므로 배열에서
 * 이름이 빠지거나 바뀌면 그 시드는 조용히 0행을 심는다. 타입으로 묶어 두면 그때 컴파일이 먼저 깨진다.
 */
type SeededNamespace = (typeof builtinCodeSchemes)[number]["namespace"];
export const AUCTION_ITEM_SCHEME: SeededNamespace = "eatbid:auction-item";

type CodeSchemeSeedDatabase = {
  insert: (table: typeof codeScheme) => {
    values: (values: Array<(typeof builtinCodeSchemes)[number]>) => {
      onConflictDoNothing: (config: { target: typeof codeScheme.namespace }) => Promise<unknown>;
    };
  };
};

export async function seedCodeSchemes(db: CodeSchemeSeedDatabase): Promise<void> {
  await db
    .insert(codeScheme)
    .values([...builtinCodeSchemes])
    .onConflictDoNothing({ target: codeScheme.namespace });
}
