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

describe("builtin code scheme seed", () => {
  test("contains exactly the approved namespaces", () => {
    expect(builtinCodeSchemes.map(({ namespace }) => namespace)).toEqual(approvedNamespaces);
    expect(builtinCodeSchemes).toEqual(approvedCodeSchemes);
  });

  test("inserts only code scheme namespaces with conflict handling", async () => {
    const inserted: Array<{ table: unknown; values: unknown; target: unknown }> = [];
    const db = {
      insert(table: unknown) {
        return {
          values(values: unknown) {
            return {
              async onConflictDoNothing({ target }: { target: unknown }) {
                inserted.push({ table, values, target });
              },
            };
          },
        };
      },
    };

    await seedCodeSchemes(db);

    expect(inserted).toEqual([
      {
        table: codeScheme,
        values: approvedCodeSchemes,
        target: codeScheme.namespace,
      },
    ]);
  });
});
