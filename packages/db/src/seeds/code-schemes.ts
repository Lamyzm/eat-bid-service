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
] as const;

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
