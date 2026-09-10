/** @module 책임: 결정 화면이 쓰는 판정 문구를 한 곳에 모으고, 각 문구가 원본 `BID_STT` 코드의 라벨인지 우리가 그날 하한·낙찰값과 견줘 만든 파생 서술인지를 타입으로 남긴다(PDR-0002). */
import type { RowVerdict } from './rehearsal';

/**
 * 문구의 근거. `source`는 eaT 명단 행의 판정 코드 라벨 그대로이고, `derived`는 손잡이 값을 우리가 계산한
 * 그날 하한(하한율 × 추첨 예정가격)이나 투찰률 축 낙찰값과 비교해 만든 서술이다. 소스는 `002`·`005`만
 * 판정하므로 파생 문구는 판정처럼 읽히는 단정(무효·유효·실격·탈락)을 쓰지 않고 사실만 서술한다.
 */
export type VerdictBasis =
  | { readonly kind: 'source'; readonly scheme: 'BID_STT'; readonly code: '002' | '005' }
  | { readonly kind: 'derived'; readonly comparedWith: 'day-floor' | 'awarded-bid-rate' | 'none' };

export type VerdictPhrase = {
  readonly text: string;
  readonly sub?: string;
  readonly basis: VerdictBasis;
};

/** 화면이 판정어로 써서는 안 되는 말. 소스 판정 코드에 없는데 판정처럼 읽힌다. */
export const FORBIDDEN_VERDICT_WORDS: readonly string[] = ['무효', '유효', '실격', '탈락', '미달', '유찰'];

/** 원본 판정 코드 라벨. 소스 전수에서 관측된 코드는 이 둘뿐이다. */
export const SOURCE_VERDICT_PHRASE = {
  '002': { text: '낙찰', basis: { kind: 'source', scheme: 'BID_STT', code: '002' } },
  '005': { text: '낙찰실패', basis: { kind: 'source', scheme: 'BID_STT', code: '005' } }
} as const satisfies Record<'002' | '005', VerdictPhrase>;

/** 표 마지막 열처럼 회차 하나에 붙는 "이 값을 그때 냈다면" 서술. `judgeRow`의 값과 1:1이다. */
export const ROW_VERDICT_PHRASE = {
  won: { text: '낙찰값 이하', basis: { kind: 'derived', comparedWith: 'awarded-bid-rate' } },
  missed: { text: '낙찰값 위', basis: { kind: 'derived', comparedWith: 'awarded-bid-rate' } },
  invalid: { text: '하한 아래', basis: { kind: 'derived', comparedWith: 'day-floor' } },
  unknown: { text: '—', basis: { kind: 'derived', comparedWith: 'none' } }
} as const satisfies Record<RowVerdict, VerdictPhrase>;

/**
 * "이 값이면" 패널의 집계 행 문구. 그날 하한이 관측값이 아니라 계산값임을 부제가 밝힌다. 부제는 레일
 * 340px 안에서 값 열과 한 줄에 놓이므로 줄바꿈 없이 들어갈 길이를 지킨다.
 */
export const REHEARSAL_PHRASE = {
  won: {
    text: '낙찰값 이하였을 회차',
    sub: '지금 값을 그때 냈다면',
    basis: { kind: 'derived', comparedWith: 'awarded-bid-rate' }
  },
  belowDayFloor: {
    text: '그날 하한보다 낮았을 회차',
    sub: '하한율 × 예정가로 계산',
    basis: { kind: 'derived', comparedWith: 'day-floor' }
  },
  // 낙찰값 이하 회차 중 낙찰값이 손잡이 값과 0.1%p 안에 있던 회차. 두 값 모두 투찰률 축이다(EAT-87).
  nearAbove: {
    text: '낙찰값 바로 위 0.1 안에',
    sub: '낙찰값 이하 중 0.1%p 안',
    basis: { kind: 'derived', comparedWith: 'awarded-bid-rate' }
  }
} as const satisfies Record<'won' | 'belowDayFloor' | 'nearAbove', VerdictPhrase>;

/**
 * 손잡이가 비어 있을 때 표 마지막 열과 "이 값이면" 패널이 보이는 상태 문구. 화면이 값을 먼저 놓으면 그것이
 * 추천값으로 읽히므로(AGENTS 8, PDR-0004) 빈 상태는 고장이 아니라 시작 상태이며, 문구는 무엇을 하면 계산이
 * 시작되는지만 말하고 어떤 값도 예로 들지 않는다.
 */
export const NO_RATE_PHRASE = {
  header: { text: '값을 넣으면 계산', basis: { kind: 'derived', comparedWith: 'none' } },
  row: { text: '—', basis: { kind: 'derived', comparedWith: 'none' } },
  panel: { text: '값 없음', sub: '투찰률을 넣으면 지난 회차와 견줍니다', basis: { kind: 'derived', comparedWith: 'none' } }
} as const satisfies Record<'header' | 'row' | 'panel', VerdictPhrase>;

export const ALL_VERDICT_PHRASES: readonly VerdictPhrase[] = [
  ...Object.values(SOURCE_VERDICT_PHRASE),
  ...Object.values(ROW_VERDICT_PHRASE),
  ...Object.values(REHEARSAL_PHRASE),
  ...Object.values(NO_RATE_PHRASE)
];
