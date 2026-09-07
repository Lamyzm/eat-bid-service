/** @module 책임: 기관 회차 이력 응답에서 헤더·배너가 쓰는 누적 회차 수, 공고 간격 중앙값(발주 주기), 지난 공고 시점을
 * 표본 수와 함께 표시 문자열로 계산한다. 회차 이력이 없거나 못 받았으면 값을 지어내지 않고 미확인으로 남긴다. */
import { Temporal } from '@eatbid/domain';

import type { HistoryPresentation } from './attempt-history';

export type OrgCadencePresentation = {
  /** "20회" 또는 "회차 미확인". 표본 수는 응답 meta의 사실이다. */
  readonly attemptCountText: string;
  /** "보통 26일마다 공고". 간격이 하나도 없으면 null이며 화면은 이 조각을 그리지 않는다. */
  readonly cadenceText: string | null;
  /** 위 중앙값을 만든 간격 표본 수. 중앙값은 표본이 작으면 뜻이 흐려지므로 화면이 함께 적는다(AGENTS 7). */
  readonly cadenceBasisText: string | null;
  /** "지난 공고 08-13 · 21일 만". 보고 있는 공고보다 앞선 회차가 없으면 null이다. */
  readonly lastAnnouncementText: string | null;
};

type HistoryInput =
  | { readonly state: 'ready'; readonly presentation: HistoryPresentation }
  | { readonly state: 'no-organization' }
  | { readonly state: 'unavailable' };

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const pad2 = (value: number): string => value.toString().padStart(2, '0');

function kstMonthDay(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO('Asia/Seoul');
  return `${pad2(zoned.month)}-${pad2(zoned.day)}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Temporal.Instant.from(fromIso).epochMilliseconds;
  const to = Temporal.Instant.from(toIso).epochMilliseconds;
  return Math.round((to - from) / DAY_MILLISECONDS);
}

// percentile_disc(0.5)와 같은 규약이다. 짝수 표본이면 아래쪽 값을 고르며 실제 관측된 간격 하나를 말한다(평균이 아니다).
function medianDays(gaps: readonly number[]): number {
  const sorted = gaps.toSorted((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

const UNKNOWN: OrgCadencePresentation = {
  attemptCountText: '회차 미확인',
  cadenceText: null,
  cadenceBasisText: null,
  lastAnnouncementText: null
};

/**
 * 간격은 공고 시각(announcedAt)으로 잰다. 개찰 시각은 개찰 전 회차에 없어 표본이 줄지만 공고 시각은
 * 모든 회차에 있다. 같은 날 여러 품목을 따로 공고한 회차(간격 0일)는 발주 주기가 아니라 같은 발주의
 * 분할이므로 표본에서 뺀다. 표본은 응답이 실은 회차(상한 60)까지이며 그 수를 화면에 적는다.
 */
export function presentOrgCadence(history: HistoryInput, current: { readonly announcedAt: string }): OrgCadencePresentation {
  if (history.state !== 'ready') return UNKNOWN;
  const { rows, sampleCount } = history.presentation;
  const announced = rows.map((row) => row.announcedAt).toSorted();
  const gaps = announced
    .slice(1)
    .map((later, index) => daysBetween(announced[index]!, later))
    .filter((days) => days > 0);
  const previous = announced.filter((instant) => instant < current.announcedAt).at(-1) ?? null;
  return {
    attemptCountText: `${sampleCount}회`,
    cadenceText: gaps.length === 0 ? null : `보통 ${medianDays(gaps)}일마다 공고`,
    cadenceBasisText: gaps.length === 0 ? null : `간격 ${gaps.length}회 기준`,
    lastAnnouncementText: previous === null
      ? null
      : `지난 공고 ${kstMonthDay(previous)} · ${daysBetween(previous, current.announcedAt)}일 만`
  };
}
