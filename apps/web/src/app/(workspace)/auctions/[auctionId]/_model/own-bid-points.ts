/** @module 책임: 내 투찰 batch 응답을 흐름 차트의 own 점과 회차 상태 요약으로 옮기며 원문 비율·금액 부재·회차별 상태 구분을 보존한다. */
import type { UTCTimestamp } from 'lightweight-charts';
import type { BidObservationAttemptKey, MyAttemptBidObservation } from '@eatbid/contracts/api/v1/me';

import type { HistoryRow } from './attempt-history';
import { amountText } from './bid-rate';
import { chartDay } from './flow-chart-model';

/** 내 party가 남긴 제출 한 행의 캔버스 좌표와 사람이 읽을 원문이다. DOM key는 submissionId를 쓴다. */
export type OwnChartPoint = {
  readonly time: UTCTimestamp;
  /** 렌더 좌표 전용이다. 표시와 비교는 `rateText`로 한다(AGENTS 15). */
  readonly value: number;
  /** 예정가격 분모의 원천 SAJEONG_PCT 소수 셋째 자리 그대로다. 100 초과를 지우지 않는다(ADR 0040). */
  readonly rateText: string;
  /** EFT_ALL_AMT 관측이 없으면 null이다. 계산 금액이나 환산으로 채우지 않는다(ADR 0041 §2). */
  readonly amountText: string | null;
  readonly submissionId: string;
  readonly sourceSupplierAccountId: string;
  readonly row: HistoryRow;
};

/** 회차별 결과를 서로 다른 수로 센다. "명단에 없음"과 "명단 미관측"과 "확인 불가"는 같은 사실이 아니다. */
export type OwnAttemptSummary = {
  readonly submitted: number;
  readonly submissions: number;
  readonly absent: number;
  readonly notObserved: number;
  readonly conflict: number;
};

/**
 * 회차별 결과를 센다. 어느 명단의 결과인지는 `attemptId`·`revisionId`가 정하므로 표 행 없이 물어본
 * 열쇠만으로 셀 수 있고, 그래서 이 계산은 표 행을 client provider까지 나르지 않는다(EAT-139).
 * 물어보지 않은 회차나 다른 revision의 답은 어느 명단의 결과인지 말할 수 없어 확인 불가로 센다.
 */
export function summarizeOwnAttempts(
  asked: readonly BidObservationAttemptKey[],
  observed: readonly MyAttemptBidObservation[]
): OwnAttemptSummary {
  const revisionByAttempt = new Map(asked.map((key) => [key.attemptId, key.revisionId] as const));
  const summary = { submitted: 0, submissions: 0, absent: 0, notObserved: 0, conflict: 0 };
  for (const attempt of observed) {
    if (revisionByAttempt.get(attempt.attemptId) !== attempt.revisionId) {
      summary.conflict += 1;
      continue;
    }
    switch (attempt.result.kind) {
      case 'submitted':
        summary.submitted += 1;
        summary.submissions += attempt.result.rows.length;
        break;
      case 'absent-from-roster':
        summary.absent += 1;
        break;
      case 'roster-not-observed':
        summary.notObserved += 1;
        break;
      case 'evidence-conflict':
        summary.conflict += 1;
        break;
    }
  }
  return summary;
}

/**
 * 캔버스에 놓을 점. 개찰일 좌표와 회차 원문이 필요하므로 이미 그 행을 가진 차트 쪽에서 만든다.
 * 행이 없거나 revision이 다르면 어느 명단의 결과인지 말할 수 없어 점으로 놓지 않고, 개찰일이 없는
 * 회차는 x 좌표가 없어 요약에만 남는다.
 */
export function buildOwnPoints(
  rows: readonly HistoryRow[],
  observed: readonly MyAttemptBidObservation[]
): readonly OwnChartPoint[] {
  const byAttempt = new Map(rows.map((row) => [row.attemptId, row] as const));
  const points: OwnChartPoint[] = [];
  for (const attempt of observed) {
    const row = byAttempt.get(attempt.attemptId);
    if (!row || row.revisionId !== attempt.revisionId || row.openedAt == null) continue;
    if (attempt.result.kind !== 'submitted') continue;
    for (const submission of attempt.result.rows) {
      points.push({
        time: chartDay(row.openedKstDay),
        value: Number(submission.bidRate.value),
        rateText: submission.bidRate.value,
        amountText: submission.submittedAmount ? amountText(submission.submittedAmount.amount) : null,
        submissionId: submission.submissionId,
        sourceSupplierAccountId: submission.sourceSupplierAccountId,
        row
      });
    }
  }
  points.sort((a, b) => a.time - b.time || a.value - b.value);
  return points;
}

/** own 점만으로 비율 축 범위를 정할 때 쓴다. 낙찰 점의 `flowObservedRange`와 같은 여백 규칙이다. */
export function ownObservedRange(points: readonly OwnChartPoint[]): { readonly from: number; readonly to: number } | null {
  if (points.length === 0) return null;
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max(0.01, (high - low) * 0.08);
  return { from: Math.max(0, low - padding), to: high + padding };
}

/**
 * 0인 항목은 말하지 않는다. 어느 항목도 없으면 제출 기록이 없다고만 말하며 "미참여"라는 판정 단어를 쓰지
 * 않는다 — 명단 미관측 회차가 섞여 있으면 참여했는지 자체를 모르는 상태다(AGENTS 3).
 */
export function ownSummaryText(summary: OwnAttemptSummary): string {
  const parts = [
    summary.submitted > 0 ? `내 투찰 ${summary.submissions}건(${summary.submitted}회차)` : null,
    summary.absent > 0 ? `명단에 없음 ${summary.absent}회` : null,
    summary.notObserved > 0 ? `명단 미관측 ${summary.notObserved}회` : null,
    summary.conflict > 0 ? `확인 불가 ${summary.conflict}회` : null
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return '조회한 회차에 내 제출 기록이 없습니다';
  return parts.join(' · ');
}
