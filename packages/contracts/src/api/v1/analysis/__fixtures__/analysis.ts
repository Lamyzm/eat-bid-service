export const analysisFilterFixture = {
  targetOrganizationId: "9007199254740993",
  excludeAttemptId: "89",
  period: { from: "2026-01-15", to: "2026-03-14" },
  dateBasis: "opened",
  comparisonScope: { kind: "region", scheme: "eat:auction-location-sido", codeValueId: "41" },
  floorRate: { value: "90.000", unit: "percentage-points" },
  awardMethodCodeValueId: "71",
  listCountRange: { min: 12, max: 24 },
  itemFilter: { kind: "all" },
} as const;

export const analysisOptionsFixture = {
  regions: [{ codeValueId: "41", scheme: "eat:auction-location-sido", code: "48", label: "경상남도", parentCodeValueId: null, active: true }],
  floorRates: [{ value: "90.000", unit: "percentage-points" }],
  awardMethods: [{ codeValueId: "71", scheme: "eat:award-method", code: "001", label: "관측된 낙찰방식" }],
  availablePeriods: { opened: { from: "2021-01-01", to: "2026-09-14" }, announced: null },
} as const;

const lineage = {
  sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  calcVersion: "analysis-r1",
  computedAt: "2026-09-14T01:10:00Z",
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
} as const;

export const analysisMetaFixture = {
  state: "ready",
  effectiveFilter: analysisFilterFixture,
  snapshot: {
    sourceCutoffAt: "2026-09-14T01:00:00Z",
    issuedAt: "2026-09-14T01:11:00Z",
    expiresAt: "2026-09-15T01:11:00Z",
    observationPolicyVersion: "awarded-attempt-v1",
    builds: [
      { purpose: "observations", lineage: { ...lineage, buildId: "501" } },
      { purpose: "distribution", lineage: { ...lineage, buildId: "907" } },
    ],
  },
  targetSampleCount: 8,
  comparisonSampleCount: 120,
  overlapCount: 6,
  periodCoverage: [{ period: analysisFilterFixture.period, target: "unknown", comparison: "unknown" }],
  freshness: { state: "current", checkedAt: "2026-09-14T01:11:00Z" },
} as const;
