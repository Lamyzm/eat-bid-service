import { describe, expect, test } from "bun:test";
import {
  assertExactNodeVersion,
  createAndCloseApplicationContext,
  expectedNodeVersion,
  installedPackageVersions,
} from "./compatibility-probe";

describe("검증 범위를 정의한다 — compiled Nest 12 compatibility probe", () => {
  test("허용 조건을 검증한다 — accepts only the exact pinned Node runtime", () => {
    expect(expectedNodeVersion).toBe("v24.20.0");
    expect(assertExactNodeVersion("v24.20.0")).toBe("v24.20.0");
    expect(() => assertExactNodeVersion("v24.2.0")).toThrow(
      "Expected Node v24.20.0, received v24.2.0",
    );
  });

  test("생성 결과를 검증한다 — creates and closes the real Nest application context", async () => {
    await expect(createAndCloseApplicationContext()).resolves.toEqual({ closed: true });
  });

  test("읽기 결과를 검증한다 — reads exact installed runtime versions without package export shortcuts", () => {
    expect(installedPackageVersions()).toEqual({
      nestVersion: "12.0.1",
      effectVersion: "4.0.0-rc.112",
    });
  });
});
