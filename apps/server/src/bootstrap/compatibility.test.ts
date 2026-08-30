import { describe, expect, test } from "bun:test";
import {
  assertExactNodeVersion,
  createAndCloseApplicationContext,
  expectedNodeVersion,
  installedPackageVersions,
} from "./compatibility-probe";

describe("compiled Nest 12 compatibility probe", () => {
  test("accepts only the exact pinned Node runtime", () => {
    expect(expectedNodeVersion).toBe("v24.20.0");
    expect(assertExactNodeVersion("v24.20.0")).toBe("v24.20.0");
    expect(() => assertExactNodeVersion("v24.2.0")).toThrow(
      "Expected Node v24.20.0, received v24.2.0",
    );
  });

  test("creates and closes the real Nest application context", async () => {
    await expect(createAndCloseApplicationContext()).resolves.toEqual({ closed: true });
  });

  test("reads exact installed runtime versions without package export shortcuts", () => {
    expect(installedPackageVersions()).toEqual({
      nestVersion: "12.0.1",
      effectVersion: "4.0.0-rc.112",
    });
  });
});
