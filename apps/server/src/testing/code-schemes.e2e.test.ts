import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import { codeSchemeV1Operations, listCodesV1ResponseSchema } from "@eatbid/contracts";
import { fixedClock, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type {
  CodeListingQuery,
  CodeReader,
  CodeReleaseListing,
} from "../modules/reference/application/code-reader";
import { signedInSessionAuthenticator } from "../../fixtures/session-authenticator.fixture";

const environment = parseEnvironment({
  NODE_ENV: "test",
  PORT: "0",
  DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:1/eatbid_test",
});

const clock = fixedClock(Temporal.Instant.from("2026-09-06T01:00:00Z"));

const SCHEME = "mois:administrative-region";

const codesPath = (scheme: string, query?: { grain?: string }): string =>
  codeSchemeV1Operations.listCodes.buildPath({ path: { scheme }, query });

const listing: CodeReleaseListing = {
  release: {
    codeReleaseId: 7n,
    sourceVersion: "2026-09-06",
    publishedAt: null,
    promotedGrain: ["sido", "sigungu"],
  },
  codes: [
    {
      codeValueId: 1101n,
      code: "1100000000",
      label: "서울특별시",
      parentCodeValueId: null,
      grain: "sido",
      active: true,
      validFrom: null,
      validTo: null,
      coordinate: { latitude: 37.5665, longitude: 126.978, crs: "EPSG:4326" },
    },
    {
      codeValueId: 1102n,
      code: "1111000000",
      label: "종로구",
      parentCodeValueId: 1101n,
      grain: "sigungu",
      active: true,
      validFrom: null,
      validTo: null,
      coordinate: null,
    },
  ],
};

async function withServer(
  reader: CodeReader,
  run: (server: Server) => Promise<void>,
): Promise<void> {
  const runtime = await createApp({
    environment,
    clock,
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => true },
    codeReader: reader,
    sessionAuthenticator: signedInSessionAuthenticator,
  } as never);
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    await run(server);
  } finally {
    await runtime.shutdown();
  }
}

function readerDouble(overrides: Partial<CodeReader> = {}): CodeReader {
  return { readActiveRelease: async () => listing, ...overrides };
}

describe("코드 체계 목록 HTTP 경로", () => {
  test("계약에서 파생한 경로가 활성 release의 코드와 meta를 제한 JSON으로 돌려준다", async () => {
    await withServer(readerDouble(), async (server) => {
      const response = await request(server).get(codesPath(SCHEME));
      expect(response.status).toBe(200);
      expect(listCodesV1ResponseSchema.parse(response.body)).toEqual(response.body);
      expect(response.body.scheme).toBe(SCHEME);
      expect(response.body.codes).toEqual([
        {
          codeValueId: "1101",
          scheme: SCHEME,
          code: "1100000000",
          label: "서울특별시",
          parentCodeValueId: null,
          active: true,
          validFrom: null,
          validTo: null,
          coordinate: { latitude: 37.5665, longitude: 126.978, crs: "EPSG:4326" },
        },
        {
          codeValueId: "1102",
          scheme: SCHEME,
          code: "1111000000",
          label: "종로구",
          parentCodeValueId: "1101",
          active: true,
          validFrom: null,
          validTo: null,
          coordinate: null,
        },
      ]);
      expect(response.body.meta).toEqual({
        codeReleaseId: "7",
        sourceVersion: "2026-09-06",
        publishedAt: null,
        promotedGrain: ["sido", "sigungu"],
        codesWithoutCoordinateCount: 1,
      });
    });
  });

  test("grain query를 그대로 조회 port에 넘긴다", async () => {
    const observed: CodeListingQuery[] = [];
    await withServer(readerDouble({
      readActiveRelease: async (query) => {
        observed.push(query);
        return listing;
      },
    }), async (server) => {
      const response = await request(server).get(codesPath(SCHEME, { grain: "sigungu" }));
      expect(response.status).toBe(200);
    });
    expect(observed).toEqual([{ scheme: SCHEME, grain: "sigungu" }]);
  });

  test("활성 release가 없는 체계는 빈 배열이 아니라 404 Problem이다", async () => {
    await withServer(readerDouble({ readActiveRelease: async () => null }), async (server) => {
      const response = await request(server).get(codesPath("eat:unknown-scheme"));
      expect(response.status).toBe(404);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.body.code).toBe("NOT_FOUND");
    });
  });

  test("계약이 거부하는 query는 400 Problem으로 닫힌다", async () => {
    await withServer(readerDouble(), async (server) => {
      const response = await request(server).get(`${codesPath(SCHEME)}?unknown=1`);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });
  });

  test("조회 의존성 장애는 404가 아니라 503 Problem이다", async () => {
    await withServer(readerDouble({
      readActiveRelease: async () => { throw new Error("connection refused"); },
    }), async (server) => {
      const response = await request(server).get(codesPath(SCHEME));
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("DEPENDENCY_UNAVAILABLE");
    });
  });
});
