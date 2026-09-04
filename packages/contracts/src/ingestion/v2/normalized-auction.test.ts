import { describe, expect, test } from "bun:test";

import { normalizedAuctionV1Schema } from "../v1/normalized-auction";
import { normalizedAuctionV2Schema } from "./normalized-auction";

const v1Fixture = {
  contractVersion: "eatbid.ingestion.auction.v1",
  identity: {
    externalBidId: "5669410",
    displayBidNumber: "E251117-000000-0",
    title: "비식별 급식 식재료 구매",
    status: "낙찰",
  },
  buyer: { organizationCode: "153045", organizationName: "비식별 구매기관" },
  location: { sidoCode: "15", sigunguCode: "653", eligibilityCodes: ["15653"] },
  schedule: {
    announcedAt: "2025-11-17T00:00:00Z",
    deadlineAt: "2025-11-20T01:00:00Z",
    openedAt: "2025-11-20T02:20:00Z",
  },
  pricing: {
    baseAmount: { amount: "6913400.00", currency: "KRW" },
    plannedAmount: { amount: "6762461.00", currency: "KRW" },
  },
  classification: { sourceCategoryLabel: "축산물", categorySource: "source_field" },
} as const;

const account = {
  sourceSystem: "eat",
  accountCode: { sourceSystem: "eat", codeScheme: "eat:SHIPPER_CD", code: "221212", label: "비식별 업체 1" },
  businessNumber: { sourceSystem: "eat", codeScheme: "eat:BIZ_NO", code: "1000000000", label: null },
} as const;

const v2Fixture = {
  ...v1Fixture,
  contractVersion: "eatbid.ingestion.auction.v2",
  terms: {
    floorRate: { value: "90.000", unit: "percentage-points" },
    plannedPriceMethod: { sourceSystem: "eat", codeScheme: "eat:PLNPRC_TYPE_CD", code: "002", label: "복수예정가격" },
    awardMethod: { sourceSystem: "eat", codeScheme: "eat:SUCBD_DECISION_MTHD", code: "003", label: null },
  },
  roster: {
    sourceRosterSize: 85,
    submissions: [
      {
        supplierAccount: account,
        submittedAt: "2025-11-19T09:14:39Z",
        amount: { amount: "6101000.00", currency: "KRW" },
        effectiveAmount: { amount: "6101000.00", currency: "KRW" },
        bidRate: { value: "90.218", unit: "percentage-points" },
        rank: 1,
        sourceStatus: { sourceSystem: "eat", codeScheme: "eat:BID_STT", code: "002", label: "낙찰" },
        withdrawalFlag: { sourceSystem: "eat", codeScheme: "eat:WITHDRAWAL_YN", code: "N", label: null },
        drawNumbers: ["7", "3"],
        observedRosterSize: 85,
      },
    ],
  },
  award: {
    supplierAccount: account,
    awardedAt: "2025-11-20T00:00:00Z",
    awardedRate: { value: "90.218", unit: "percentage-points" },
    awardedAmount: { amount: "6101000.00", currency: "KRW" },
    runnerUpRate: { value: "90.382", unit: "percentage-points" },
    sourceStatus: { sourceSystem: "eat", codeScheme: "eat:BID_STT", code: "002", label: "낙찰" },
  },
  reservePriceDraw: {
    candidates: [
      {
        sequence: 1,
        ratio: { value: "0.971700", unit: "ratio" },
        amount: { amount: "6717477.00", currency: "KRW" },
        chosen: { sourceSystem: "eat", codeScheme: "eat:CHC_YN", code: "Y", label: null },
      },
    ],
  },
  lineage: { parentExternalBidId: null, links: [] },
} as const;

describe("eaT 정규화 공고 V2 수집 계약", () => {
  test("v1 root는 v2 필드가 없어도 그대로 통과한다", () => {
    expect(normalizedAuctionV1Schema.parse(v1Fixture)).toEqual(v1Fixture);
  });

  test("v1 payload는 v2 root를 통과하지 못한다", () => {
    expect(() => normalizedAuctionV2Schema.parse(v1Fixture)).toThrow();
  });

  test("명단 한 행이 단위 봉투를 갖춘 채로 통과한다", () => {
    expect(normalizedAuctionV2Schema.parse(v2Fixture)).toEqual(v2Fixture);
  });

  test("사정률을 숫자로 넘기면 거부한다", () => {
    const broken = structuredClone(v2Fixture) as Record<string, unknown>;
    (broken.roster as { submissions: { bidRate: unknown }[] }).submissions[0]!.bidRate = 90.218;
    expect(() => normalizedAuctionV2Schema.parse(broken)).toThrow();
  });

  test("소수 세 자리가 아닌 사정률 문자열을 거부한다", () => {
    const broken = structuredClone(v2Fixture) as Record<string, unknown>;
    (broken.roster as { submissions: { bidRate: { value: string } }[] }).submissions[0]!.bidRate.value = "91.87";
    expect(() => normalizedAuctionV2Schema.parse(broken)).toThrow();
  });

  test("명단이 비어 있고 낙찰이 없는 상세도 유효한 v2 record다", () => {
    const empty = {
      ...v2Fixture,
      roster: { sourceRosterSize: null, submissions: [] },
      award: null,
      reservePriceDraw: { candidates: [] },
    };
    expect(normalizedAuctionV2Schema.parse(empty).award).toBeNull();
  });

  test("root id는 v1과 다르고 계약 버전 리터럴이 v2로 좁혀진다", () => {
    expect(normalizedAuctionV2Schema.meta()?.id).toBe("EatbidIngestionAuctionV2");
    const wrongVersion = { ...v2Fixture, contractVersion: "eatbid.ingestion.auction.v1" };
    expect(() => normalizedAuctionV2Schema.parse(wrongVersion)).toThrow();
  });

  test("알려지지 않은 필드는 v2 블록에서도 거부한다", () => {
    const candidates = [
      { ...v2Fixture, rawRoster: [] },
      { ...v2Fixture, terms: { ...v2Fixture.terms, floorAmount: null } },
      { ...v2Fixture, lineage: { ...v2Fixture.lineage, attemptOrdinal: 1 } },
    ];
    for (const candidate of candidates) {
      expect(normalizedAuctionV2Schema.safeParse(candidate).success).toBe(false);
    }
  });

  test("판정 코드를 문자열로 평탄화해 넘기면 거부한다", () => {
    const broken = structuredClone(v2Fixture) as Record<string, unknown>;
    (broken.roster as { submissions: { sourceStatus: unknown }[] }).submissions[0]!.sourceStatus = "002";
    expect(() => normalizedAuctionV2Schema.parse(broken)).toThrow();
  });
});
