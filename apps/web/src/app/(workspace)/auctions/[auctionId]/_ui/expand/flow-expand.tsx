/** @module 책임: 흐름 크게 보기 본문 — 흐름 차트를 모달 폭으로 키워 재사용하고 같은 x 좌표에 회차별 명단 수 막대를 붙인다. */
import type { HistoryPresentation, HistoryRow } from '../../_model/attempt-history';
import { FlowChart } from '../flow-chart';
import { FLOW_VIEW_WIDTH, PLOT_LEFT, TICK_LABEL_X, flowPoints } from '../flow-geometry';

const BARS_HEIGHT = 72;
const BAR_TOP = 12;
const BAR_BOTTOM = BARS_HEIGHT - 16;
const BAR_WIDTH = 10;

/**
 * 막대 눈금은 흐름 차트처럼 고정 창(0~30+)이다. 명단이 197인 회차 하나가 축을 다 먹으면 나머지
 * 회차의 10~30 차이가 몇 px로 뭉개진다. 창을 넘는 값은 잘라 그리되 숫자를 위에 적어 숨기지 않는다.
 */
const LIST_WINDOW_MAX = 30;

function barHeight(count: number): number {
  const ratio = Math.min(count, LIST_WINDOW_MAX) / LIST_WINDOW_MAX;
  return ratio * (BAR_BOTTOM - BAR_TOP);
}

/**
 * x 좌표를 흐름 차트의 `flowPoints`에서 그대로 받아 위 차트의 점과 같은 열에 놓는다. 낙찰률이 없어 점이
 * 없는 회차는 차트에도 없으므로 여기서도 빠진다 — 두 그림이 다른 회차 집합을 그리면 열이 어긋난다.
 */
export function ListCountBars({ rows }: { readonly rows: readonly HistoryRow[] }) {
  const listByAttempt = new Map(rows.map((row) => [row.attemptId, row.listCount] as const));
  const bars = flowPoints(rows).map((point) => ({ key: point.key, x: point.x, count: listByAttempt.get(point.key) ?? null }));
  return (
    <svg viewBox={`0 0 ${FLOW_VIEW_WIDTH} ${BARS_HEIGHT}`} role='img' aria-label='회차별 명단 수' className='h-auto w-full'>
      <g className='text-muted-foreground'>
        <text x={TICK_LABEL_X} y={BAR_TOP + 4} textAnchor='end' fontSize={10} fontWeight={600} fill='currentColor'>
          {`${LIST_WINDOW_MAX}+`}
        </text>
        <text x={TICK_LABEL_X} y={BAR_BOTTOM} textAnchor='end' fontSize={10} fontWeight={600} fill='currentColor'>
          명단 0
        </text>
        <line x1={PLOT_LEFT} x2={FLOW_VIEW_WIDTH - 4} y1={BAR_BOTTOM} y2={BAR_BOTTOM} stroke='currentColor' strokeWidth={1} className='text-border' />
      </g>
      {bars.map((bar) =>
        bar.count === null ? null : (
          <g key={bar.key} className='text-foreground/30'>
            <rect x={bar.x - BAR_WIDTH / 2} y={BAR_BOTTOM - barHeight(bar.count)} width={BAR_WIDTH} height={barHeight(bar.count)} fill='currentColor' />
            {bar.count > LIST_WINDOW_MAX ? (
              <text x={bar.x} y={BAR_TOP - 2} textAnchor='middle' fontSize={10} fontWeight={600} fill='currentColor' className='text-muted-foreground'>
                {bar.count}
              </text>
            ) : null}
          </g>
        )
      )}
    </svg>
  );
}

/**
 * 흐름 차트 파일은 손대지 않고 prop만 넘긴다. 차트 svg는 자기 높이(h-60)를 갖고 있어 모달에서는 wrapper의
 * 자식 선택자로 viewBox 비율대로 키운다 — 폭이 넓어져도 점·선 두께는 viewBox 단위라 같이 커진다.
 */
export function FlowExpand({
  presentation,
  myRate
}: {
  readonly presentation: HistoryPresentation;
  readonly myRate: string | null;
}) {
  return (
    <div className='grid min-w-0 gap-2 [&_figure>svg]:h-auto [&_figure>svg]:max-h-[60dvh]'>
      <FlowChart presentation={presentation} myRate={myRate} />
      <ListCountBars rows={presentation.rows} />
    </div>
  );
}
