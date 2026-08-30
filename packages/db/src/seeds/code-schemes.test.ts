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
];

describe("검증 범위를 정의한다 — builtin code scheme seed", () => {
  test("동작을 검증한다 — contains exactly the approved namespaces", () => {
    expect(builtinCodeSchemes.map(({ namespace }) => namespace)).toEqual(approvedNamespaces);
    expect(builtinCodeSchemes).toEqual(approvedCodeSchemes);
  });

  test("상태를 검증한다 — is idempotent and preserves all semantic scheme metadata", async () => {
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
    expect(rows).toHaveLength(7);
    expect(conflictTargets).toEqual([codeScheme.namespace, codeScheme.namespace]);
  });
});
