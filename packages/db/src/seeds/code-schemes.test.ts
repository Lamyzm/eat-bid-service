import { describe, expect, test } from "bun:test";
import { codeScheme } from "../schema/core/codes";
import { builtinCodeSchemes, seedCodeSchemes } from "./code-schemes";

const approvedNamespaces = [
  "eat:auction-location-sido",
  "eat:auction-location-sigungu",
  "eat:eligibility-area",
  "mois:administrative-region",
  "neis:school",
  "eat:organization",
  "eat:supplier-account",
  "eat:bid-status",
  "eat:withdrawal-flag",
  "eat:business-number",
  "eat:planned-price-type",
  "eat:award-method",
  "eat:reserve-price-selection-flag",
  "eat:attempt-status",
];

// eaT 상세 파서(`apps/dataplane/src/eatbid/source/eat/code_schemes.py`)가 싣는 여덟이다. 같은 목록을
// Python 쪽 `test_code_schemes.py`가 반대 방향으로 검사하므로 한쪽만 늘리면 반드시 실패한다.
const eatDetailParserNamespaces = [
  "eat:bid-status",
  "eat:withdrawal-flag",
  "eat:supplier-account",
  "eat:business-number",
  "eat:planned-price-type",
  "eat:award-method",
  "eat:reserve-price-selection-flag",
  "eat:attempt-status",
];

const approvedCodeSchemes = [
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
];

describe("내장 code scheme seed", () => {
  test("승인된 namespace만 정확히 포함한다", () => {
    expect(builtinCodeSchemes.map(({ namespace }) => namespace)).toEqual(approvedNamespaces);
    expect(builtinCodeSchemes).toEqual(approvedCodeSchemes);
  });

  test("멱등하게 실행하며 모든 의미 scheme metadata를 보존한다", async () => {
    const rows = new Map<string, (typeof approvedCodeSchemes)[number]>();
    const conflictTargets: unknown[] = [];
    const db = {
      insert(table: typeof codeScheme) {
        expect(table).toBe(codeScheme);
        return {
          values(values: Array<(typeof approvedCodeSchemes)[number]>) {
            return {
              async onConflictDoNothing({ target }: { target: unknown }) {
                conflictTargets.push(target);
                for (const value of values) {
                  rows.set(value.namespace, rows.get(value.namespace) ?? value);
                }
              },
            };
          },
        };
      },
    };

    await seedCodeSchemes(db);
    await seedCodeSchemes(db);

    expect([...rows.values()]).toEqual(approvedCodeSchemes);
    expect(rows).toHaveLength(14);
    expect(conflictTargets).toEqual([codeScheme.namespace, codeScheme.namespace]);
  });

  test("eat 코드 체계를 전부 등록한다", () => {
    const seeded = new Set(builtinCodeSchemes.map(({ namespace }) => namespace));
    const missing = eatDetailParserNamespaces.filter((namespace) => !seeded.has(namespace));

    expect(missing).toEqual([]);
    // 소스 column명을 정체성으로 되돌리는 회귀를 막는다. `eat:SHIPPER_CD`처럼 대문자 소스 column이
    // 다시 namespace가 되면 같은 code scheme이 두 이름을 갖게 된다(AGENTS 2·6).
    const sourceColumnShaped = [...seeded].filter((namespace) => /[A-Z_]/.test(namespace.split(":")[1] ?? ""));
    expect(sourceColumnShaped).toEqual([]);
  });
});
