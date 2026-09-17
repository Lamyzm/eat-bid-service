import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertPortUsable,
  choosePort,
  isPortExcluded,
  parseExcludedPortRanges,
  readExcludedPortRanges,
} from "./ports.mjs";

const NETSH_OUTPUT = `
Protocol tcp Port Exclusion Ranges

Start Port    End Port
----------    --------
      4352        4451
      4552        4651
     50000       50059     *

* - Administered port exclusions.
`;

describe("Windows 예약 포트 대역 읽기", () => {
  test("netsh 출력에서 시작·끝 쌍만 골라내고 머리글과 각주는 버린다", () => {
    assert.deepEqual(parseExcludedPortRanges(NETSH_OUTPUT), [
      { start: 4352, end: 4451 },
      { start: 4552, end: 4651 },
      { start: 50_000, end: 50_059 },
    ]);
  });

  test("예약 대역은 양 끝을 포함하고 그 사이 한 칸도 내주지 않는다", () => {
    const ranges = parseExcludedPortRanges(NETSH_OUTPUT);
    assert.equal(isPortExcluded(4352, ranges), true);
    assert.equal(isPortExcluded(4451, ranges), true);
    assert.equal(isPortExcluded(4600, ranges), true);
    assert.equal(isPortExcluded(4452, ranges), false);
    assert.equal(isPortExcluded(3000, ranges), false);
  });

  test("Windows가 아닌 곳에서는 예약 대역이 없다고 답한다", () => {
    assert.deepEqual(readExcludedPortRanges("linux"), []);
  });
});

describe("빈 포트 고르기", () => {
  const ranges = [{ start: 4400, end: 4410 }];

  test("예약 대역과 이미 쓰는 자리를 건너뛰고 첫 빈 자리를 고른다", async () => {
    const occupied = new Set([4411, 4412]);
    const chosen = await choosePort({
      from: 4400,
      ranges,
      free: async (port) => !occupied.has(port),
    });
    assert.equal(chosen, 4413);
  });

  test("찾는 범위 안에 자리가 없으면 조용히 다른 자리를 쓰지 않고 실패한다", async () => {
    await assert.rejects(
      choosePort({ from: 4400, ranges, span: 11, free: async () => true }),
      /4400부터 11칸/,
    );
  });
});

describe("사람이 못 박은 포트 판정", () => {
  const ranges = [{ start: 4552, end: 4651 }];

  test("예약 대역이면 netsh 확인 방법을 함께 알려 준다", async () => {
    await assert.rejects(
      assertPortUsable(4600, { ranges, free: async () => true, label: "개발 DB" }),
      /excludedportrange/,
    );
  });

  test("이미 쓰는 자리는 예약과 다른 이유로 거절한다", async () => {
    await assert.rejects(
      assertPortUsable(4000, { ranges, free: async () => false, label: "개발 DB" }),
      /이미 다른 프로세스/,
    );
  });

  test("쓸 수 있으면 그 포트를 그대로 돌려준다", async () => {
    assert.equal(
      await assertPortUsable(4000, { ranges, free: async () => true, label: "개발 DB" }),
      4000,
    );
  });
});
