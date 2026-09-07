/** @module 책임: 기관 회차 이력을 직접 그린 inline SVG 흐름 차트로 렌더링한다 — 사정률 창의 낙찰·2등·내 값, 아래 띠의 명단 막대, KST 달 라벨을 범례 토글에 따라 겹친다. */
'use client';

import type { HistoryPresentation } from '../_model/attempt-history';
import { DAY_FLOOR_WITHHELD_REASON, FLOW_AXIS, FLOW_SERIES, decideMyRateLine, type FlowSeriesKey } from '../_model/flow-series';
import { useBidRate } from './bid-rate-context';
import {
  BAR_BOTTOM,
  BAR_TOP,
  FLOW_TICKS,
  FLOW_VIEW_HEIGHT,
  FLOW_VIEW_WIDTH,
  LIST_BAR_CAP,
  MONTH_LABEL_Y,
  PLOT_LEFT,
  PLOT_RIGHT,
  TICK_LABEL_X,
  flowPoints,
  listBars,
  monthLabels,
  myRatePlacement,
  tickY,
  type FlowPoint
} from './flow-geometry';
import { useFlowSeriesVisibility } from './flow-legend';

const UNKNOWN = '미확인';

const SERIES_NAME = Object.fromEntries(FLOW_SERIES.map((series) => [series.key, series.name])) as Record<FlowSeriesKey, string>;

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

// 막대 띠의 눈금은 위가 상한, 아래가 0이다. 이름은 사정률 이름과 같은 자리·크기로 두어 두 띠가 다른 축임을 같은 어법으로 말한다.
function BarAxis() {
  return (
    <g className='text-muted-foreground'>
      <text x={TICK_LABEL_X} y={BAR_TOP - 16} textAnchor='end' fontSize={10} fontWeight={600} fill='currentColor'>
        {SERIES_NAME.listCount}
      </text>
      <text x={TICK_LABEL_X} y={BAR_TOP + 4} textAnchor='end' fontSize={13} fontWeight={600} fill='currentColor'>
        {`${LIST_BAR_CAP}+`}
      </text>
      <text x={TICK_LABEL_X} y={BAR_BOTTOM + 4} textAnchor='end' fontSize={13} fontWeight={600} fill='currentColor'>
        0
      </text>
    </g>
  );
}

function ListBars({ points }: { readonly points: readonly FlowPoint[] }) {
  return (
    <g data-series='list-count' className='text-muted-foreground'>
      {listBars(points).map((bar) => (
        <g key={bar.key}>
          <rect x={bar.x} y={bar.top} width={bar.width} height={BAR_BOTTOM - bar.top} fill='currentColor' opacity={0.45} />
          {bar.overflowText === null ? null : (
            <text x={bar.x + bar.width / 2} y={bar.top - 3} textAnchor='middle' fontSize={11} fontWeight={600} fill='currentColor'>
              {bar.overflowText}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

function MonthAxis({ points }: { readonly points: readonly FlowPoint[] }) {
  return (
    <g data-axis='month' className='text-muted-foreground'>
      {monthLabels(points).map((label) => (
        <text key={label.text} x={label.x} y={MONTH_LABEL_Y} textAnchor='middle' fontSize={13} fontWeight={600} fill='currentColor'>
          {label.text}
        </text>
      ))}
    </g>
  );
}

// 선은 선택 품목의 회차만, 그것도 창 안에 있는 점만 잇는다. 다른 품목은 경쟁 구조가 달라 같은 선으로
// 이으면 추세처럼 보이는 거짓이 되고, 경계에 붙인 창 밖 점을 이으면 없는 평평한 구간이 생긴다.
function selectedPath(points: readonly FlowPoint[], y: (point: FlowPoint) => number | null): string {
  return points
    .flatMap((point) => {
      const value = point.selected ? y(point) : null;
      return value === null ? [] : [`${point.x},${value}`];
    })
    .join(' ');
}

// 2등은 낙찰 바로 위의 얇은 점선이다. 낙찰선과 같은 굵기면 어느 쪽이 낙찰인지 색으로만 갈리게 된다.
function RunnerUpSeries({ points }: { readonly points: readonly FlowPoint[] }) {
  const path = selectedPath(points, (point) => point.runnerUpY);
  return (
    <g data-series='runner-up' className='text-muted-foreground'>
      {path ? <polyline points={path} fill='none' stroke='currentColor' strokeWidth={1.5} strokeDasharray='3 3' /> : null}
      {points.map((point) =>
        point.runnerUpY === null ? null : <circle key={point.key} cx={point.x} cy={point.runnerUpY} r={2.5} fill='currentColor' />
      )}
    </g>
  );
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

const MINE_PILL_HEIGHT = 22;

// 내 값은 회차 점과 같은 높이로 지나가므로 글자만 얹으면 겹쳐 읽을 수 없다. 디자인 원본처럼 채운 알약 위에
// 얹고, 창 위쪽에 붙어 알약이 잘릴 때만 선 아래로 내린다.
function MyRatePill({ text, y, width }: { readonly text: string; readonly y: number; readonly width: number }) {
  const below = y - MINE_PILL_HEIGHT - 2 < 0;
  const top = below ? y + 2 : y - MINE_PILL_HEIGHT - 2;
  return (
    <>
      <rect x={PLOT_RIGHT - width} y={top} width={width} height={MINE_PILL_HEIGHT} rx={6} fill='currentColor' />
      <text x={PLOT_RIGHT - width / 2} y={top + 15} textAnchor='middle' fontSize={13} fontWeight={700} fill='var(--primary-foreground)'>
        {text}
      </text>
    </>
  );
}

// 내 값 선은 사정률로 놓은 값(URL `myRate`)만 긋는다. 창 밖 값은 경계에 붙이면 창 끝값에 놓은 것처럼
// 읽히므로 선을 긋지 않고 방향과 함께 "범위 밖"이라고만 쓴다(EAT-80 후속).
function MyRateLine({ rate }: { readonly rate: string }) {
  const mine = myRatePlacement(rate);
  if (mine.outside !== null) {
    return (
      <g data-slot='flow-my-rate-outside' className='text-primary'>
        <MyRatePill text={`${SERIES_NAME.myRate} ${rate} ${mine.outside === 'above' ? '▲' : '▼'} 범위 밖`} y={mine.y} width={150} />
      </g>
    );
  }
  return (
    <g className='text-primary'>
      {/* 안내문이 "굵은 선이 내 값"이라 말하므로 낙찰선(2)보다 실제로 굵어야 한다. 디자인 원본도 3이다. */}
      <line data-series='my-rate' x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={mine.y} y2={mine.y} stroke='currentColor' strokeWidth={3} />
      <MyRatePill text={`${SERIES_NAME.myRate} ${rate}`} y={mine.y} width={92} />
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
  const visible = useFlowSeriesVisibility();
  const points = flowPoints(presentation.rows);
  const line = decideMyRateLine({ myRate, bidRate: rate });
  const path = selectedPath(points, (point) => (point.outside === null ? point.y : null));

  return (
    // 이름은 svg 하나만 갖는다. figure에도 같은 aria-label을 두면 보조기술이 같은 이름을 두 번 읽는다.
    <figure className='m-0 grid gap-2'>
      <svg viewBox={`0 0 ${FLOW_VIEW_WIDTH} ${FLOW_VIEW_HEIGHT}`} role='img' aria-label='회차별 낙찰률 흐름' className='h-auto w-full'>
        <Grid />
        <TickLabels />
        <BarAxis />
        {visible.listCount ? <ListBars points={points} /> : null}
        <MonthAxis points={points} />
        {visible.runnerUp ? <RunnerUpSeries points={points} /> : null}
        {visible.win && path ? <polyline points={path} fill='none' stroke='currentColor' strokeWidth={2} strokeLinejoin='round' /> : null}
        {points.map((point) =>
          point.selected ? (
            visible.win ? <circle key={point.key} data-item='selected' cx={point.x} cy={point.y} r={3.5} fill='currentColor' /> : null
          ) : visible.otherItems ? (
            <circle key={point.key} data-item='other' cx={point.x} cy={point.y} r={3.5} fill='none' stroke='currentColor' strokeWidth={1.5} />
          ) : null
        )}
        {points.map((point) =>
          point.outside === null || !(point.selected ? visible.win : visible.otherItems) ? null : <OutsideMark key={`outside-${point.key}`} point={point} />
        )}
        {visible.myRate && line.kind === 'drawn' ? <MyRateLine rate={line.rate} /> : null}
      </svg>
      {visible.myRate && line.kind === 'withheld' ? (
        // 범례에 "내 값"이 있는데 선이 없으면 고장으로 읽힌다. 선을 긋지 않은 이유를 차트 바로 아래에서 말한다.
        <p data-slot='flow-my-rate-note' className='text-[13px] font-medium text-muted-foreground'>
          {line.reason}
        </p>
      ) : null}
      {/* 과거 회차 표에는 그날 하한 열이 있는데 차트에는 없다. 그 차이가 누락이 아니라 축의 결정임을 여기서 말한다(PDR-0004). */}
      <p data-slot='flow-day-floor-note' className='text-[13px] font-medium text-muted-foreground'>
        {DAY_FLOOR_WITHHELD_REASON}
      </p>
      <figcaption className='text-[13px] font-medium text-muted-foreground'>{caption(presentation, points.length)}</figcaption>
    </figure>
  );
}
