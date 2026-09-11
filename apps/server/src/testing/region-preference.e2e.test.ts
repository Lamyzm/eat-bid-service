// docker 없이 Nest ingress만 세우고 계약 경로·guard·응답 schema를 실제 HTTP로 확인한다. 저장소는
// 주입한 port이며 SQL 경계는 `region-filter.integration.test.ts`가 실제 PostgreSQL로 따로 고정한다.
import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import {
  eligibilityAreaV1Operations,
  myRegionPreferenceV1Operations,
} from "@eatbid/contracts";
import { fixedClock, Temporal } from "@eatbid/domain";

import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type {
  EligibilityAreaCatalog,
  EligibilityAreaReader,
  RegionCoverageRecord,
} from "../modules/procurement/application/eligibility-area-reader";
import type {
  RegionPreferenceRecord,
  RegionPreferenceRepository,
  ReplaceRegionPreferenceInput,
  ReplaceRegionPreferenceResult,
} from "../modules/account/application/region-preference-repository";
import type { AccountRepository } from "../modules/account/application/account-repository";
import { kstDate } from "../modules/procurement/domain/kst-day";
import { signedInSessionAuthenticator } from "../../fixtures/session-authenticator.fixture";

const NOW = Temporal.Instant.from("2026-09-07T01:30:00Z");
const origin = "http://localhost:3000";

const environment = parseEnvironment({
  NODE_ENV: "test",
  PORT: "0",
  DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:1/eatbid_test",
});

const area = (codeValueId: bigint, code: string, label: string | null) => ({
  codeValueId,
  code,
  scheme: "eat:eligibility-area",
  label,
});

const catalog: EligibilityAreaCatalog = {
  scheme: "eat:eligibility-area",
  groups: [
    {
      all: area(9_101n, "15000", "경남/전체"),
      parts: [area(9_102n, "15653", "경남/김해시"), area(9_103n, "15714", "경남/창원시")],
    },
    { all: area(9_201n, "05000", null), parts: [] },
  ],
  areaCount: 4,
  unlabeledAreaCount: 1,
};

const coverage: RegionCoverageRecord = {
  today: { matchedCount: 9, unobservedCount: 7, nationwideCount: 404 },
  window: { daysWithAuctions: 31, medianDayCount: 12, peakDay: { date: kstDate("2026-06-22"), count: 117 } },
  snapshotLineage: null,
};

const saved: RegionPreferenceRecord = {
  areas: [area(9_101n, "15000", "경남/전체"), area(9_102n, "15653", "경남/김해시")],
  confirmedAt: Temporal.Instant.from("2026-09-11T00:00:00Z"),
};

/**
 * `PrincipalGuard`는 계정 저장소의 주체 해소 하나만 쓴다. 워크스페이스 owner를 여기서 주면 DB 없이
 * guard·역할 판정까지 실제 요청 경로로 지나간다(ADR 0032 §2).
 */
const accountRepository = {
  findPrincipalBySubject: async () => ({
    principalId: 1n,
    workspace: { workspaceId: 7n, name: "내 워크스페이스", role: "owner" as const },
  }),
} as unknown as AccountRepository;

async function withServer(
  overrides: {
    readonly reader?: Partial<EligibilityAreaReader>;
    readonly repository?: Partial<RegionPreferenceRepository>;
  },
  run: (server: Server) => Promise<void>,
): Promise<void> {
  const application = await createApp({
    environment,
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => true },
    clock: fixedClock(NOW),
    sessionAuthenticator: signedInSessionAuthenticator,
    accountRepository,
    eligibilityAreaReader: {
      listAreas: async () => catalog,
      previewCoverage: async () => coverage,
      ...overrides.reader,
    },
    regionPreferenceRepository: {
      readPreference: async () => saved,
      replacePreference: async () => ({ kind: "replaced", preference: saved }),
      ...overrides.repository,
    },
  } as never);
  const server = await application.listen(0, "127.0.0.1");
  try {
    await run(server);
  } finally {
    await application.shutdown();
  }
}

describe("참가제한지역 HTTP 경계", () => {
  test("선택 목록이 계약 경로에서 시도 묶음과 라벨 결측 수를 그대로 싣는다", async () => {
    await withServer({}, async (server) => {
      const response = await request(server)
        .get(eligibilityAreaV1Operations.listEligibilityAreas.buildPath({ path: undefined }));
      expect(response.status).toBe(200);
      expect(response.body.scheme).toBe("eat:eligibility-area");
      expect(response.body.groups[0].all.codeValueId).toBe("9101");
      expect(response.body.groups[0].parts.map((part: { code: string }) => part.code))
        .toEqual(["15653", "15714"]);
      // 라벨이 관측되지 않은 코드도 목록에 남고 그 수가 meta에 실린다.
      expect(response.body.groups[1].all.label).toBeNull();
      expect(response.body.meta).toEqual({ areaCount: 4, unlabeledAreaCount: 1 });
    });
  });

  test("미리보기가 오늘 셋과 몰리는 날을 창 경계와 함께 답한다", async () => {
    await withServer({}, async (server) => {
      const response = await request(server)
        .post(eligibilityAreaV1Operations.previewRegionCoverage.buildPath({ path: undefined }))
        .set("origin", origin)
        .send({ codeValueIds: ["9101", "9102"] });
      expect(response.status).toBe(200);
      expect(response.body.today).toEqual({ matchedCount: 9, unobservedCount: 7, nationwideCount: 404 });
      expect(response.body.window.peakDay).toEqual({ date: "2026-06-22", count: 117 });
      // 창의 양끝은 주입된 clock이 정한다. 90일 전과 기준 시각이 응답에 그대로 있어야 재현된다.
      expect(response.body.window.windowEnd).toBe("2026-09-07T01:30:00Z");
      expect(response.body.window.windowStart).toBe("2026-06-09T01:30:00Z");
    });
  });
});

describe("내 관심 지역 HTTP 경계", () => {
  test("조회가 저장된 코드와 확인 시각을 계약 형태로 답한다", async () => {
    await withServer({}, async (server) => {
      const response = await request(server)
        .get(myRegionPreferenceV1Operations.getMyRegionPreference.buildPath({ path: undefined }));
      expect(response.status).toBe(200);
      expect(response.body.preference.areas.map((entry: { code: string }) => entry.code))
        .toEqual(["15000", "15653"]);
      expect(response.body.preference.confirmedAt).toBe("2026-09-11T00:00:00Z");
    });
  });

  test("교체가 코드 목록을 통째로 넘기고 빈 목록도 유효한 요청이다", async () => {
    const requests: ReplaceRegionPreferenceInput[] = [];
    await withServer({
      repository: {
        replacePreference: async (input) => {
          requests.push(input);
          return { kind: "replaced", preference: saved } satisfies ReplaceRegionPreferenceResult;
        },
      },
    }, async (server) => {
      const path = myRegionPreferenceV1Operations.putMyRegionPreference.buildPath({ path: undefined });
      const replaced = await request(server).put(path).set("origin", origin).send({ codeValueIds: ["9102"] });
      const cleared = await request(server).put(path).set("origin", origin).send({ codeValueIds: [] });
      expect(replaced.status).toBe(200);
      expect(cleared.status).toBe(200);
      expect(requests.map((entry) => entry.codeValueIds)).toEqual([[9_102n], []]);
    });
  });

  test("참가제한지역 체계에 없는 코드는 400이고 알 수 없는 key는 저장소 앞에서 막힌다", async () => {
    let calls = 0;
    await withServer({
      repository: {
        replacePreference: async () => {
          calls += 1;
          return { kind: "unknown-area" } satisfies ReplaceRegionPreferenceResult;
        },
      },
    }, async (server) => {
      const path = myRegionPreferenceV1Operations.putMyRegionPreference.buildPath({ path: undefined });
      const unknown = await request(server).put(path).set("origin", origin).send({ codeValueIds: ["9999"] });
      const malformed = await request(server).put(path).set("origin", origin).send({ add: ["9102"] });
      expect(unknown.status).toBe(400);
      expect(malformed.status).toBe(400);
      // 알 수 없는 본문은 저장소에 닿기 전에 계약이 막는다.
      expect(calls).toBe(1);
    });
  });
});
