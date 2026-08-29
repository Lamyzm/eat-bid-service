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
