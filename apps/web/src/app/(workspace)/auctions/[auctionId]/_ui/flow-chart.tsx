/** @module 책임: 기관 회차 이력을 직접 그린 inline SVG 흐름 차트로 렌더링하고, 같은 사정률 축으로 놓인 내 값 선만 그 위에 겹친다. */
'use client';

import type { HistoryPresentation } from '../_model/attempt-history';
import { FLOW_AXIS, decideMyRateLine } from '../_model/flow-series';
import { useBidRate } from './bid-rate-context';
import {
  FLOW_TICKS,
  FLOW_VIEW_HEIGHT,
  FLOW_VIEW_WIDTH,
  PLOT_LEFT,
  PLOT_RIGHT,
  TICK_LABEL_X,
  flowPoints,
  myRatePlacement,
  tickY,
  type FlowPoint
} from './flow-geometry';

const UNKNOWN = '미확인';

// 보유율은 표본을 어디까지 믿어도 되는지를 말한다. 영문 판정값을 그대로 보이면 화면이 계약 어휘를
// 사용자에게 떠넘긴다.
const COVERAGE_TEXT: Record<'complete' | 'partial' | 'none' | 'unknown' | 'missing', string> = {
  complete: '완전',
  partial: '일부',
  none: '없음',
  unknown: '모름',
  missing: UNKNOWN
};

// "최근 N회 표시"의 N은 실제로 그린 점 수다. 낙찰률이 없는 회차는 y를 만들 수 없어 점이 없으므로
// 응답 행 수를 쓰면 차트에 없는 회차까지 그렸다고 말하게 된다.
function caption(presentation: HistoryPresentation, shown: number): string {
  return [
    `표본 ${presentation.sampleCount}회`,
    `최근 ${shown}회 표시`,
    `build ${presentation.buildId ?? UNKNOWN}`,
    `계산 ${presentation.calcVersion ?? UNKNOWN}`,
    `산출 ${presentation.computedAtText ?? UNKNOWN}`,
    // 모집단을 어디까지 덮었는지 모르는 표본이라면 화면이 그 사실을 먼저 말해야 한다(PDR-0003).
    `모집단 ${COVERAGE_TEXT[presentation.coverage ?? 'missing']}`
  ].join(' · ');
}

function Grid() {
  return (
    <g className='text-border'>
      {FLOW_TICKS.map((tick, index) => (
        <line key={tick} x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={tickY(index)} y2={tickY(index)} stroke='currentColor' strokeWidth={1} />
      ))}
    </g>
  );
}

// 눈금 이름은 눈금 숫자와 같은 열에 둔다. 숫자만 보이면 레일의 투찰률과 같은 축으로 읽히고, 그 오독이
// 바로 손잡이 값을 이 눈금에 꽂게 만든 원인이다(PDR-0004). 위쪽 여백 16 안에서 맨 위 눈금 글자(13px,
// baseline 20)와 겹치지 않으려면 10px 글자를 baseline 8에 둬야 한다.
function TickLabels() {
  return (
    <g className='text-muted-foreground'>
      <text x={TICK_LABEL_X} y={8} textAnchor='end' fontSize={10} fontWeight={600} fill='currentColor'>
        {FLOW_AXIS.name}
      </text>
      {FLOW_TICKS.map((tick, index) => (
        <text key={tick} x={TICK_LABEL_X} y={tickY(index) + 4} textAnchor='end' fontSize={13} fontWeight={600} fill='currentColor'>
          {tick}
        </text>
      ))}
    </g>
  );
}

// 선은 선택 품목의 회차만, 그것도 창 안에 있는 점만 잇는다. 다른 품목은 경쟁 구조가 달라 같은 선으로
// 이으면 추세처럼 보이는 거짓이 되고, 경계에 붙인 창 밖 점을 이으면 없는 평평한 구간이 생긴다.
function selectedPath(points: readonly FlowPoint[]): string {
  return points
    .filter((point) => point.selected && point.outside === null)
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
}

// 창 밖 표시는 경계 점 바깥에 쓰되 viewBox 안에 머물러야 한다. 13px 글자의 baseline을 14/232에 두면
// 위로 글자 높이가, 아래로 descender가 위아래 여백 16 안에 들어온다.
function OutsideMark({ point }: { readonly point: FlowPoint }) {
  const above = point.outside === 'above';
  return (
    <text
      x={point.x}
      y={above ? point.y - 2 : point.y + 8}
      textAnchor='middle'
      fontSize={13}
      fontWeight={600}
      fill='currentColor'
      className='text-muted-foreground'
    >
      {`${above ? '▲' : '▼'} ${point.rateText}`}
    </text>
  );
}

const MINE_PILL_WIDTH = 92;
const MINE_PILL_HEIGHT = 22;

// 내 값은 회차 점·하한 눈금과 같은 높이로 지나가므로 글자만 얹으면 겹쳐 읽을 수 없다. 디자인 원본처럼
// 채운 알약 위에 얹고, 창 위쪽에 붙어 알약이 잘릴 때만 선 아래로 내린다.
function MyRateLabel({ rate, y }: { readonly rate: string; readonly y: number }) {
  const below = y - MINE_PILL_HEIGHT - 2 < 0;
  const top = below ? y + 2 : y - MINE_PILL_HEIGHT - 2;
  return (
    <>
      <rect x={PLOT_RIGHT - MINE_PILL_WIDTH} y={top} width={MINE_PILL_WIDTH} height={MINE_PILL_HEIGHT} rx={6} fill='currentColor' />
      <text
        x={PLOT_RIGHT - MINE_PILL_WIDTH / 2}
        y={top + 15}
        textAnchor='middle'
        fontSize={13}
        fontWeight={700}
        fill='var(--primary-foreground)'
      >
        {`내 값 ${rate}`}
      </text>
    </>
  );
}

// 내 값 선은 사정률로 놓은 값(URL `myRate`)만 긋는다. 레일의 투찰률은 분모가 달라 이 눈금 위의
// 선이 될 수 없으므로 여기서는 각주에 그 값이 왜 없는지 말하는 데만 쓴다(PDR-0004, EAT-80).
function MyRateLine({ rate }: { readonly rate: string }) {
  const mine = myRatePlacement(rate);
  return (
    <g className='text-primary'>
      {/* 안내문이 "굵은 선이 내 값"이라 말하므로 낙찰선(2)보다 실제로 굵어야 한다. 디자인 원본도 3이다. */}
      <line data-series='my-rate' x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={mine.y} y2={mine.y} stroke='currentColor' strokeWidth={3} />
      <MyRateLabel rate={rate} y={mine.y} />
    </g>
  );
}

export function FlowChart({
  presentation,
  myRate
}: {
  readonly presentation: HistoryPresentation;
  readonly myRate: string | null;
}) {
  const { rate } = useBidRate();
  const points = flowPoints(presentation.rows);
  const line = decideMyRateLine({ myRate, bidRate: rate });
  const path = selectedPath(points);

  return (
    // 이름은 svg 하나만 갖는다. figure에도 같은 aria-label을 두면 보조기술이 같은 이름을 두 번 읽는다.
    <figure className='m-0 grid gap-2'>
      <svg viewBox={`0 0 ${FLOW_VIEW_WIDTH} ${FLOW_VIEW_HEIGHT}`} role='img' aria-label='회차별 낙찰률 흐름' className='h-60 w-full'>
        <Grid />
        <TickLabels />
        <g className='text-destructive'>
          {points.map((point) =>
            point.floorY === null ? null : (
              <line key={`floor-${point.key}`} x1={point.x - 4} x2={point.x + 4} y1={point.floorY} y2={point.floorY} stroke='currentColor' strokeWidth={1.5} />
            )
          )}
        </g>
        {path ? <polyline points={path} fill='none' stroke='currentColor' strokeWidth={2} strokeLinejoin='round' /> : null}
        {points.map((point) =>
          point.selected ? (
            <circle key={point.key} data-item='selected' cx={point.x} cy={point.y} r={3.5} fill='currentColor' />
          ) : (
            <circle key={point.key} data-item='other' cx={point.x} cy={point.y} r={3.5} fill='none' stroke='currentColor' strokeWidth={1.5} />
          )
        )}
        {points.map((point) => (point.outside === null ? null : <OutsideMark key={`outside-${point.key}`} point={point} />))}
        {line.kind === 'drawn' ? <MyRateLine rate={line.rate} /> : null}
      </svg>
      {line.kind === 'withheld' ? (
        // 범례에 "내 값"이 있는데 선이 없으면 고장으로 읽힌다. 선을 긋지 않은 이유를 차트 바로 아래에서 말한다.
        <p data-slot='flow-my-rate-note' className='text-[13px] font-medium text-muted-foreground'>
          {line.reason}
        </p>
      ) : null}
      <figcaption className='text-[13px] font-medium text-muted-foreground'>{caption(presentation, points.length)}</figcaption>
    </figure>
  );
}
