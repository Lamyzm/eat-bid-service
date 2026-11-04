import { describe, expect, test } from "bun:test";
import { Temporal } from "@eatbid/domain";

import { decideSeatAssignment, type AssignmentSituation, type CoveringSeat, type CurrentAssignment } from "./seat-assignment";

const at = Temporal.Instant.from("2026-11-05T01:00:00Z");
const deadlineAt = Temporal.Instant.from("2026-11-06T02:00:00Z");

const seat = (id: bigint, workspaceId: bigint, priority: string, overrides: Partial<CoveringSeat> = {}): CoveringSeat => ({
  marketSeatId: id,
  workspaceId,
  state: "active",
  startsAt: Temporal.Instant.from("2026-11-01T15:00:00Z"),
  endsAt: Temporal.Instant.from("2027-02-01T15:00:00Z"),
  priorityStartedAt: Temporal.Instant.from(priority),
  ...overrides,
});

const current = (marketSeatId: bigint, workspaceId: bigint, kind: CurrentAssignment["kind"] = "took"): CurrentAssignment => ({
  assignmentId: 90n,
  workspaceId,
  marketSeatId,
  kind,
});

const situation = (overrides: Partial<AssignmentSituation>): AssignmentSituation => ({
  at,
  hasItem: true,
  deadlineAt,
  coveringSeats: [],
  current: null,
  ...overrides,
});

describe("공고 금액 배정 규칙", () => {
  test("처음 맡을 때는 걸친 활성 자리 중 우선권 시작일이 이른 자리가 맡고, 같으면 번호가 작은 자리가 맡는다", () => {
    const early = seat(7n, 2n, "2026-10-01T00:00:00Z");
    const later = seat(3n, 1n, "2026-10-15T00:00:00Z");
    const tie = seat(5n, 3n, "2026-10-01T00:00:00Z");
    const decision = decideSeatAssignment(situation({ coveringSeats: [later, early, tie] }));
    expect(decision).toEqual({ kind: "take", seat: tie, candidates: [tie, early, later] });
  });

  test("선점·되찾기·제안 상태와 기간 밖의 자리는 금액을 받지 않는다 — 끝 시각은 기간에 들지 않는다", () => {
    const decision = decideSeatAssignment(situation({
      coveringSeats: [
        seat(1n, 1n, "2026-10-01T00:00:00Z", { state: "held" }),
        seat(2n, 2n, "2026-10-01T00:00:00Z", { state: "reclaim" }),
        seat(3n, 3n, "2026-10-01T00:00:00Z", { endsAt: at }),
        seat(4n, 4n, "2026-10-01T00:00:00Z", { startsAt: Temporal.Instant.from("2026-11-05T01:00:01Z") }),
      ],
    }));
    expect(decision).toEqual({ kind: "none", reason: "no-seat" });
  });

  test("맡은 자리가 살아 있으면 더 이른 우선권 자리가 생겨도 마감까지 그대로 간다", () => {
    const mine = seat(9n, 2n, "2026-10-20T00:00:00Z");
    const earlier = seat(1n, 1n, "2026-09-01T00:00:00Z");
    const held = current(9n, 2n);
    expect(decideSeatAssignment(situation({ coveringSeats: [earlier, mine], current: held })))
      .toEqual({ kind: "keep", current: held });
  });

  test("맡은 자리가 끝나면 다음 후보에게 넘기고, 다음 후보가 없으면 맡은 줄을 비운다", () => {
    const next = seat(1n, 1n, "2026-09-01T00:00:00Z");
    const ended = seat(9n, 2n, "2026-08-01T00:00:00Z", { endsAt: Temporal.Instant.from("2026-11-04T15:00:00Z") });
    const held = current(9n, 2n);
    expect(decideSeatAssignment(situation({ coveringSeats: [ended, next], current: held })))
      .toEqual({ kind: "hand-over", from: held, seat: next, candidates: [next] });
    expect(decideSeatAssignment(situation({ coveringSeats: [ended], current: held })))
      .toEqual({ kind: "vacate", from: held });
  });

  test("정정공고로 맡은 자리가 더는 걸치지 않으면 넘긴다", () => {
    const other = seat(1n, 1n, "2026-09-01T00:00:00Z");
    const held = current(9n, 2n);
    expect(decideSeatAssignment(situation({ coveringSeats: [other], current: held })))
      .toEqual({ kind: "hand-over", from: held, seat: other, candidates: [other] });
  });

  test("품목 코드가 없는 공고는 시범 동안 금액을 내지 않고, 이미 맡은 줄이 있으면 비운다", () => {
    const covering = seat(1n, 1n, "2026-09-01T00:00:00Z");
    expect(decideSeatAssignment(situation({ hasItem: false, coveringSeats: [covering] })))
      .toEqual({ kind: "none", reason: "no-item" });
    const held = current(1n, 1n);
    expect(decideSeatAssignment(situation({ hasItem: false, coveringSeats: [covering], current: held })))
      .toEqual({ kind: "vacate", from: held });
  });

  test("마감이 지났거나 마감 시각을 모르면 새로 맡지 않고, 맡은 줄은 넘기지도 비우지도 않는다", () => {
    const covering = seat(1n, 1n, "2026-09-01T00:00:00Z");
    expect(decideSeatAssignment(situation({ deadlineAt: at, coveringSeats: [covering] })))
      .toEqual({ kind: "none", reason: "closed" });
    expect(decideSeatAssignment(situation({ deadlineAt: null, coveringSeats: [covering] })))
      .toEqual({ kind: "none", reason: "deadline-unknown" });
    const held = current(9n, 2n);
    expect(decideSeatAssignment(situation({ deadlineAt: at, coveringSeats: [covering], current: held })))
      .toEqual({ kind: "keep", current: held });
  });

  test("마감 뒤 확정되거나 운영자가 정정한 줄은 자리가 사라져도 금액 요청이 바꾸지 않는다", () => {
    for (const kind of ["confirmed", "corrected"] as const) {
      const fixed = current(9n, 2n, kind);
      expect(decideSeatAssignment(situation({ hasItem: false, coveringSeats: [], current: fixed })))
        .toEqual({ kind: "keep", current: fixed });
    }
  });
});
