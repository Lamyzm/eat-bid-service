/**
 * @module 책임: 복기 응답을 달 탭·방법별 성적 표·공고별 사정률 눈금자와 판정 문장으로 바꾸는 표시 모델을 소유한다.
 *
 * 눈금은 하나다 — 금액 ÷ (기초금액 × 하한율). 화면 사정률은 그 100배이고 그날 하한(예정가격 ÷ 기초금액)도 같은 눈금에 놓인다. 축은
 * 화면 전체가 같아서 우리 값은 세로로 줄 서고, 하한과 1등 자리만 날마다 움직인다. 문구는 관측 사실끼리만 견준다 — 우리가 들어가면
 * 예정가격 추첨이 바뀌므로 "넣었다면 낙찰"이라고 말하지 않는다.
 *
 * 1등 자리 끝은 낙찰이 아니라 다른 업체의 가장 낮은 유효 투찰이다. 판정 칩이 그 기준으로 나오므로 칸도 같은 기준으로 그려야 그림과
 * 문장이 어긋나지 않는다(우리가 낙찰한 공고, 가장 낮은 투찰이 심사에서 빠진 공고).
 */
import { Temporal } from '@eatbid/domain';
import type { BidReviewRoundWire, MyBidReviewV1Response } from '@eatbid/contracts/api/v1/me';

type Selected = NonNullable<MyBidReviewV1Response['selected']>;
type Summary = Selected['summaries'][number];
type Verdict = BidReviewRoundWire['own'][number]['verdict'];
type MethodKey = Summary['method'];

/** 눈금자 양 끝(사정률)이다. 그날 하한은 기초금액 ±3.1% 안에서 뽑혀 이 축 안에 든다. */
export const AXIS = { from: 97.5, to: 102 } as const;
export const AXIS_TICKS: readonly number[] = [98, 99, 100, 101, 102];

const VERDICT_TEXT: Record<Verdict, string> = {
  won: '낙찰',
  'below-floor': '하한 미달',
  first: '1등 자리',
  'above-first': '1등 자리보다 높음'
};

export interface ReviewMark {
  readonly position: number;
  readonly label: string;
  readonly first: boolean;
}

export interface ReviewRowView {
  readonly id: string;
  readonly href: `/auctions/${string}`;
  readonly title: string;
  readonly meta: readonly string[];
  readonly won: boolean;
  readonly facts: string;
  /** 하한부터 1등 자리 끝(다른 업체 가장 낮은 유효 투찰)까지다. 그런 투찰이 없으면 축 끝까지다. */
  readonly band: { readonly from: number; readonly to: number };
  /** 실제 낙찰 자리다. 1등 자리 끝과 다를 수 있다. 유효 투찰이 없었으면 null이다. */
  readonly winner: number | null;
  readonly lanes: Readonly<Record<'own' | 'market-pick' | 'national-rule' | 'morning-habit', readonly ReviewMark[]>>;
  readonly verdicts: readonly { readonly name: string; readonly text: string; readonly first: boolean }[];
  readonly anyFirst: boolean;
  readonly ownBelowFloor: boolean;
}

export interface ReviewSummaryRow {
  readonly key: MethodKey;
  readonly name: string;
  readonly note: string;
  readonly values: string;
  /** 이 달에 값이 있던 공고가 없다. 숫자 칸을 0이 아니라 빈 칸으로 보인다 — 0은 성적이고 기록 없음은 성적이 아니다. */
  readonly empty: boolean;
  readonly rounds: number;
  readonly first: number;
  readonly firstText: string;
  readonly allBelowFloor: number;
  readonly allAboveFirst: number;
  readonly expected: string;
  readonly lead: boolean;
}

export interface ReviewMonthTab {
  readonly month: string;
  readonly label: string;
  readonly rounds: number;
  readonly wins: number;
}

export type ReviewView =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'review';
      readonly month: string;
      readonly year: string;
      readonly years: readonly { readonly year: string; readonly latestMonth: string }[];
      readonly monthTabs: readonly ReviewMonthTab[];
      readonly lede: string;
      readonly stamp: string;
      readonly summary: readonly ReviewSummaryRow[];
      readonly notes: readonly string[];
      readonly rows: readonly ReviewRowView[];
      readonly hasHabit: boolean;
    };

/** 비율(`1.009115`)을 사정률 소수 셋째 자리(`100.912`)로 옮긴다. 문자열 그대로 반올림해 Number 오차를 화면에 들이지 않는다. */
export function assessmentText(ratio: string): string {
  const [whole, fraction = ''] = ratio.split('.');
  const digits = BigInt(`${whole}${fraction.padEnd(6, '0').slice(0, 6)}`);
  // 비율 6자리 = 사정률 4자리. 넷째 자리를 반올림해 셋째 자리까지 남긴다.
  const rounded = (digits + BigInt(5)) / BigInt(10);
  const text = rounded.toString().padStart(4, '0');
  return `${text.slice(0, -3)}.${text.slice(-3)}`;
}

/** 눈금자 위 자리(0~100)다. 화면 배치에만 쓰는 근사라 Number로 계산한다. */
export function axisPosition(ratio: string): number {
  const value = Number(ratio) * 100;
  return Math.min(100, Math.max(0, ((value - AXIS.from) / (AXIS.to - AXIS.from)) * 100));
}

const monthNumber = (month: string) => Number(month.slice(5, 7));
const grouped = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const wonText = (amount: string) => `${grouped(amount.split('.')[0]!)}원`;

const pad = (value: number) => String(value).padStart(2, '0');

/** 개찰 시각을 KST 달력으로 읽는다. eaT 개찰은 KST이고 기기 시간대를 따르면 해외에서 연 화면이 하루를 다르게 읽는다. */
function kstParts(instant: string): { readonly date: string; readonly time: string } {
  const time = Temporal.Instant.from(instant).toZonedDateTimeISO('Asia/Seoul');
  return { date: `${pad(time.month)}.${pad(time.day)}`, time: `${pad(time.hour)}:${pad(time.minute)}` };
}

function methodName(key: MethodKey, month: string): string {
  if (key === 'own') return '실제 낸 값';
  if (key === 'market-pick') return `${monthNumber(month)}월 맞춤`;
  if (key === 'national-rule') return '전국 공식';
  return '아침 갱신';
}

function shortName(key: MethodKey): string {
  if (key === 'own') return '낸 값';
  if (key === 'market-pick') return '맞춤';
  if (key === 'national-rule') return '전국 공식';
  return '아침 갱신';
}

function ownLabels(rounds: readonly BidReviewRoundWire[]): string {
  const labels = new Set<string>();
  for (const round of rounds) for (const bid of round.own) if (bid.label !== null) labels.add(bid.label);
  return labels.size === 0 ? '내 사업자' : [...labels].join(' · ');
}

function summaryRows(selected: Selected): readonly ReviewSummaryRow[] {
  const window = `${monthNumber(selected.marketPick.window.fromMonth)}~${monthNumber(selected.marketPick.window.throughMonth)}월`;
  const marketRatios = selected.marketPick.ratios;
  const leadKey = selected.summaries
    .filter((summary) => summary.method !== 'own' && summary.rounds > 0)
    .reduce<Summary | null>((best, summary) => (best === null || Number(summary.expectedWins) > Number(best.expectedWins) ? summary : best), null)
    ?.method;
  return selected.summaries.map((summary) => {
    const recomputed = summary.recomputedRounds > 0 ? ' · 다시 계산' : '';
    const empty = summary.method !== 'own' && summary.rounds === 0;
    const note = summary.method === 'own'
      ? ownLabels(selected.rounds)
      : empty
        ? '이 달엔 기록 없음'
        : summary.method === 'market-pick'
        ? `${window} ${selected.marketPick.marketRounds ?? 0}건으로 고름${recomputed}`
        : summary.method === 'national-rule'
          ? `참여 수에 따라 표에서${recomputed}`
          : '화면에 보인 공고만';
    const values = summary.method === 'market-pick' && marketRatios !== null
      ? marketRatios.map((ratio) => assessmentText(ratio.value)).join(' / ')
      : summary.method === 'national-rule' ? '참여 수별' : '공고마다';
    const wins = summary.method === 'own' ? selected.rounds.filter((round) => round.winner?.mine === true).length : null;
    return {
      key: summary.method,
      name: methodName(summary.method, selected.month),
      note,
      values: empty ? '–' : values,
      empty,
      rounds: summary.rounds,
      first: summary.first,
      firstText: wins === null ? `${summary.first}` : `${summary.first} · 실제 낙찰 ${wins}`,
      allBelowFloor: summary.allBelowFloor,
      allAboveFirst: summary.allAboveFirst,
      expected: Number(summary.expectedWins).toFixed(1),
      lead: summary.method === leadKey
    };
  });
}

function verdictText(name: string, entries: readonly { readonly who: string; readonly ratio: string; readonly verdict: Verdict }[]) {
  const first = entries.find((entry) => entry.verdict === 'first' || entry.verdict === 'won');
  if (first !== undefined) {
    return { name, text: `${first.who} ${assessmentText(first.ratio)} ${VERDICT_TEXT[first.verdict]}`, first: true };
  }
  if (entries.every((entry) => entry.verdict === entries[0]!.verdict)) {
    return { name, text: `${entries.length > 1 ? '둘 다 ' : ''}${VERDICT_TEXT[entries[0]!.verdict]}`, first: false };
  }
  return { name, text: entries.map((entry) => `${assessmentText(entry.ratio)} ${VERDICT_TEXT[entry.verdict]}`).join(' · '), first: false };
}

function rowView(round: BidReviewRoundWire): ReviewRowView {
  const { date, time } = kstParts(round.openedAt);
  const marks = (entries: readonly { readonly ratio: string; readonly verdict: Verdict }[]): ReviewMark[] =>
    entries.map((entry) => ({
      position: axisPosition(entry.ratio),
      label: `${assessmentText(entry.ratio)} · ${VERDICT_TEXT[entry.verdict]}`,
      first: entry.verdict === 'first' || entry.verdict === 'won'
    }));
  const method = (key: 'market-pick' | 'national-rule' | 'morning-habit') =>
    round.methods.find((values) => values.method === key)?.positions.map((position) => ({ ratio: position.ratio.value, verdict: position.verdict })) ?? [];
  const own = round.own.map((bid) => ({ ratio: bid.ratio.value, verdict: bid.verdict, who: bid.label ?? '내 사업자' }));
  const verdicts = [
    verdictText(shortName('own'), own),
    ...(['market-pick', 'national-rule', 'morning-habit'] as const).flatMap((key) => {
      const entries = method(key).map((entry, index) => ({ ...entry, who: `${index + 1}번` }));
      return entries.length === 0 ? [] : [verdictText(shortName(key), entries)];
    })
  ];
  const winner = round.winner === null
    ? '유효 투찰 없음'
    : `${round.winner.mine ? '우리 낙찰' : '낙찰'} ${round.winner.label ?? '업체명 없음'} ${assessmentText(round.winner.ratio.value)}`;
  const best = round.bestCompetitorRatio?.value ?? null;
  // 낙찰이 다른 업체 최저와 같으면 한 번만 말한다. 다르면(우리 낙찰, 심사 탈락) 1등 자리 끝을 따로 밝혀 칸과 칩을 맞춘다.
  const bestFact = best === null || best === round.winner?.ratio.value ? '' : ` · 다른 업체 최저 ${assessmentText(best)}`;
  return {
    id: round.auctionId,
    href: `/auctions/${encodeURIComponent(round.auctionId)}`,
    title: round.title ?? round.organizationLabel ?? '제목 미확인',
    meta: [
      `${date} ${time} 개찰`,
      ...(round.displayBidNo === null ? [] : [round.displayBidNo]),
      `참여 ${round.bidderCount}곳`,
      `기초 ${wonText(round.baseAmount.amount)}`
    ],
    won: round.winner?.mine === true,
    facts: `하한 ${assessmentText(round.floorRatio.value)} · ${winner}${bestFact}`,
    band: { from: axisPosition(round.floorRatio.value), to: best === null ? 100 : axisPosition(best) },
    winner: round.winner === null ? null : axisPosition(round.winner.ratio.value),
    lanes: {
      own: marks(own),
      'market-pick': marks(method('market-pick')),
      'national-rule': marks(method('national-rule')),
      'morning-habit': marks(method('morning-habit'))
    },
    verdicts,
    anyFirst: verdicts.some((verdict) => verdict.first),
    ownBelowFloor: round.own.every((bid) => bid.verdict === 'below-floor')
  };
}

export function presentReview(response: MyBidReviewV1Response): ReviewView {
  const { selected } = response;
  if (selected === null) return { kind: 'empty' };
  const year = selected.month.slice(0, 4);
  const yearsSeen = new Map<string, string>();
  for (const month of response.months) yearsSeen.set(month.month.slice(0, 4), month.month);
  const summary = summaryRows(selected);
  const market = summary.find((row) => row.key === 'market-pick');
  const ownWins = selected.rounds.filter((round) => round.winner?.mine === true).length;
  const recomputed = selected.summaries.some((entry) => entry.recomputedRounds > 0);
  const rows = selected.rounds.map(rowView);
  const distribution = selected.plannedDistribution;
  return {
    kind: 'review',
    month: selected.month,
    year,
    years: [...yearsSeen].map(([value, latestMonth]) => ({ year: value, latestMonth })).toReversed(),
    monthTabs: response.months
      .filter((month) => month.month.startsWith(year))
      .map((month) => ({ month: month.month, label: `${monthNumber(month.month)}월`, rounds: month.rounds, wins: month.wins })),
    lede: `${monthNumber(selected.month)}월 공고 ${selected.rounds.length}건에 내 사업자가 넣었고, 실제 낙찰은 ${ownWins}건이에요.`
      + (market === undefined || market.rounds === 0 ? '' : ` 같은 공고에서 맞춤 값이 1등 자리에 든 공고는 ${market.first}건이에요.`),
    stamp: `맞춤 ${selected.marketPick.version}판 · 전국 공식 ${selected.nationalRuleVersion}판 · 기대는 예정가격 추첨 평균(${distribution.version}판, 공고 ${grouped(String(distribution.sourceRounds))}건)`,
    summary,
    notes: [
      ...(recomputed ? ['이 달 맞춤·전국 공식 값은 그때 화면에 없던 값이에요. 지금 규칙을 그 달 자료에 다시 돌린 것이에요. 화면에 실제로 보였던 값과의 대조는 그 값을 기록하기 시작한 뒤의 공고부터 쌓여요.'] : []),
      ...(selected.unplannedRounds > 0 ? [`예정가격이 아직 안 나온 공고 ${selected.unplannedRounds}건은 대조에서 뺐어요.`] : [])
    ],
    rows,
    hasHabit: rows.some((row) => row.lanes['morning-habit'].length > 0)
  };
}
