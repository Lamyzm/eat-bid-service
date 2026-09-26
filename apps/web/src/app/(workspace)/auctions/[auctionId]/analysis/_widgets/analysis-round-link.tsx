/**
 * @module 책임: 시간축 그림의 점 선택과 보조 패널의 회차 명단을 주소의 한 선택 상태로 잇는다.
 *
 * 둘은 서로 다른 기능 조각이라 서로를 import하지 않는다. 같은 주소 상태를 읽고 쓰는 이 위젯이 둘을 잇는다.
 */
'use client';
import { useRoundSelection } from '../_features/round-inspector/model/use-round-selection';
import { RoundInspector } from '../_features/round-inspector/ui/round-inspector';
import type { TimeSeriesView } from '../_features/time-series/model/present-time-series';
import { TimeSeriesPanel } from '../_features/time-series/ui/time-series-panel';

export function LinkedTimeSeriesPanel({
  view,
  organizationLabel,
  comparisonLabel
}: {
  readonly view: TimeSeriesView;
  readonly organizationLabel: string;
  readonly comparisonLabel: string;
}) {
  const { selected, select } = useRoundSelection();
  return (
    <TimeSeriesPanel
      view={view}
      organizationLabel={organizationLabel}
      comparisonLabel={comparisonLabel}
      selectedAttemptId={selected?.attemptId ?? null}
      onSelectPoint={(point) =>
        select({ attemptId: point.attemptId, revisionId: point.revisionId })
      }
    />
  );
}

export function AnalysisRoundInspector({
  view,
  floorRate
}: {
  readonly view: TimeSeriesView | null;
  readonly floorRate: string | null;
}) {
  const { selected, clear } = useRoundSelection();
  // 공유 링크로 연 회차가 지금 그림에 없을 수도 있다(조건이 바뀐 경우). 날짜를 모르면 지어내지 않는다.
  const point =
    view?.kind === 'plot' && selected !== null
      ? view.plot.target.find((candidate) => candidate.attemptId === selected.attemptId)
      : undefined;
  return (
    <RoundInspector
      selected={selected}
      dateText={point?.dateText ?? null}
      floorRate={floorRate}
      onClose={clear}
    />
  );
}
