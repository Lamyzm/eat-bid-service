/**
 * @module 책임: 복기에서 화면 장부에 없던 공고의 아침 갱신 값을, 공고마다 마감 10분 전을 결정 시각으로 오늘 화면과 같은 결정에 다시
 * 돌려 고르는 일을 소유한다.
 *
 * 결정 시각은 근거 성적을 잰 시각(방법 표의 `trainingDecisionLeadSeconds`)과 같다 — 그래야 이 값이 그 성적의 공고 하나다. 그 시각에
 * 같은 날 단골 결과가 모자라면 값이 꺼진다. 꺼진 공고를 다른 값으로 채우지 않는다(ADR 0067·PDR-0008 결정 7).
 */
import { bidRate, canonicalDecimal, krw, type Temporal } from "@eatbid/domain";

import { baseRelativeRatio } from "../domain/bid-review";
import { MORNING_HABIT_PICK } from "../domain/morning-habit-pick-table";
import type { BidReviewRoundRecord } from "./bid-review-reader";
import { morningHabitPickFor, type DecideMorningHabitPick } from "./decide-morning-habit-pick";

/** 같은 마감 시각의 공고는 결정 하나를 나눈다. 한 달 공고 70여 건이 마감 시각으로는 20~30개다. */
const keyOf = (instant: Temporal.Instant) => instant.toString();

/**
 * 공고별 다시 고른 아침 갱신 값(복기 눈금, 낮은 값이 1번)이다. 켜지지 않은 공고는 빠진다. 참여 수는 전국 공식 다시 계산과 같이
 * 최종 명단 수다 — 그때 화면이 본 마감 1시간 전 참여 수는 남아 있지 않다.
 */
export async function recomputedMorningHabit(input: {
  readonly decide: DecideMorningHabitPick;
  readonly workspaceId: bigint;
  readonly rounds: readonly BidReviewRoundRecord[];
}): Promise<ReadonlyMap<bigint, readonly string[]>> {
  const method = MORNING_HABIT_PICK;
  const decisionAtOf = (round: BidReviewRoundRecord) => round.deadlineAt!.subtract({ seconds: method.trainingDecisionLeadSeconds });
  const wanted = input.rounds.filter((round) =>
    round.plannedAmount !== null && round.deadlineAt !== null && round.floorRate === method.floorRate);
  if (wanted.length === 0) return new Map();
  const times = new Map<string, Temporal.Instant>();
  for (const round of wanted) times.set(keyOf(decisionAtOf(round)), decisionAtOf(round));
  const decisionTimes = [...times.values()];
  const decisions = await input.decide.decideAt({ workspaceId: input.workspaceId, decisionTimes });
  const byTime = new Map(decisionTimes.map((at, index) => [keyOf(at), decisions[index]!]));
  const picks = new Map<bigint, readonly string[]>();
  for (const round of wanted) {
    const result = morningHabitPickFor(byTime.get(keyOf(decisionAtOf(round)))!, {
      baseAmount: krw(canonicalDecimal(round.baseAmount, 2)),
      floorRate: bidRate(canonicalDecimal(round.floorRate, 3)),
      deadlineAt: round.deadlineAt,
      competitorCount: round.bidderCount,
    });
    // 마감일의 첫 공고는 낙찰 확률 기초를 세우느라 수십 ms가 걸린다. 같은 서버의 다른 요청이 기다리지 않게 틈을 준다.
    await new Promise((resolve) => setImmediate(resolve));
    if (result.state !== "applicable") continue;
    // 화면이 보인 숫자(기초금액 대비 %)를 거쳐 복기 눈금에 놓는다 — 장부 값과 같은 길이다.
    picks.set(round.auctionAttemptId, result.positions.map((position) => baseRelativeRatio(position.baseRelativeRate, round.floorRate)));
  }
  return picks;
}
