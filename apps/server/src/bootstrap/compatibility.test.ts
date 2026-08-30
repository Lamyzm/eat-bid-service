import { describe, expect, test } from "bun:test";
import {
  assertExactNodeVersion,
  createAndCloseApplicationContext,
  expectedNodeVersion,
  installedPackageVersions,
} from "./compatibility-probe";

describe("compile된 framework 호환성 probe", () => {
  test("정확히 고정한 Node runtime만 허용한다", () => {
    expect(expectedNodeVersion).toBe("v24.20.0");
    expect(assertExactNodeVersion("v24.20.0")).toBe("v24.20.0");
    expect(() => assertExactNodeVersion("v24.2.0")).toThrow(
      "Expected Node v24.20.0, received v24.2.0",
    );
  });

  test("실제 Nest application context를 생성하고 닫는다", async () => {
    await expect(createAndCloseApplicationContext()).resolves.toEqual({ closed: true });
  });

  test("package export shortcut 없이 설치된 runtime version을 정확히 읽는다", () => {
    expect(installedPackageVersions()).toEqual({
      nestVersion: "12.0.1",
      effectVersion: "4.0.0-rc.112",
    });
  });
});
