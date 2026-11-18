// 넣을 공고(web `/work`)의 88% 값이 서버 규칙과 같은지 본다. 규칙의 주인인 서버 쪽에 두고 web 표시 모델과 표본을 읽는다 —
// web은 서버 소스를 import하지 않는다(경계·import 깊이 규칙). 서버 시험은 tsc 대상이 아니라 bun만 web의 `@/` 별칭을 web
// tsconfig로 푼다.
// 같은 공고(기초금액·하한율·참여 수·관측 시각·마감)를 서버의 `positionBids`에
// 그대로 넣어 나온 순위 값과, 화면 표시 모델이 그 공고 묶음 머리에 싣는 사업장별 값을 비교한다. 표본의 규칙 칸이 낡거나 화면이
// 순위를 잘못 짝지으면 여기서 실패한다.
import { describe, expect, test } from "bun:test";

import { bidRate, canonicalDecimal, krw, Temporal } from "@eatbid/domain";

import { board, boardRows } from "../../../web/src/app/(workspace)/work/__fixtures__/bid-board";
import { presentWorkBoard } from "../../../web/src/app/(workspace)/work/_bid-values/utils/work-board";
import { positionBids } from "../modules/procurement/domain/bid-position-rule";

const NAMES = ["오뚜기축산", "신성유통", "한빛정육", "대성미트", "청솔식품"];

/** 서버 규칙이 낸 기초금액 대비 %를 화면과 같은 소수 셋째 자리 글로 옮긴다. 규칙 값은 소수 넷째 자리가 0으로 끝난다. */
function serverValues(row: (typeof boardRows)[keyof typeof boardRows]): (string | null)[] {
  const result = positionBids({
    baseAmount: krw(canonicalDecimal(row.baseAmount!.amount, 2)),
    floorRate: bidRate(canonicalDecimal(row.floorRate!.value, 3)),
    participation: { bidCount: row.bidCount!, observedAt: Temporal.Instant.from(row.observedAt) },
    deadlineAt: Temporal.Instant.from(row.closesAt!)
  });
  return NAMES.map((_, index) => {
    if (result.state !== "applicable") return null;
    const position = result.positions.find((entry) => entry.order === index + 1);
    if (position === undefined) return null;
    expect(position.baseRelativeRate.endsWith("0")).toBe(true);
    return position.baseRelativeRate.slice(0, -1);
  });
}

describe("88% 값의 서버 규칙 일치", () => {
  const view = presentWorkBoard(
    board,
    NAMES.map((name) => ({ supplierLabel: name }))
  );
  if (view.kind !== "board") throw new Error("목록이 아니다");
  const shown = new Map(
    view.days.flatMap((day) =>
      day.groups88.flatMap((group) =>
        group.rows.map((row) => [row.auctionId, group.values.map((entry) => entry.value)] as const)
      )
    )
  );

  test("88% 공고마다 같은 공고·같은 시각으로 서버 규칙이 낸 값과 화면 값이 사업장마다 같다", () => {
    for (const row of Object.values(boardRows))
      expect([row.organizationLabel, shown.get(row.auctionId)]).toEqual([
        row.organizationLabel,
        serverValues(row)
      ]);
  });

  test("88% 공고가 화면에 하나도 빠지지 않는다", () => {
    expect([...shown.keys()].toSorted()).toEqual(
      Object.values(boardRows)
        .map((row) => row.auctionId)
        .toSorted()
    );
  });
});
