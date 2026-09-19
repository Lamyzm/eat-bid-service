/** @module 책임: 새 상세 전용 공고·공통 조건·분석 준비 영역을 조립하며 이전 상세 화면에는 의존하지 않는다. */
import type { loadAnalysisPage } from '../_lib/load-analysis-page';
import { presentAnalysisContext } from '../_features/analysis-filters/model/present-analysis-context';
import { AnalysisFilters } from '../_features/analysis-filters/ui/analysis-filters';
import { AnalysisResetButton } from '../_features/analysis-filters/ui/analysis-reset-button';
import { AnalysisResultsGate } from '../_features/analysis-filters/ui/analysis-results-gate';
import { AnalysisWorkspace } from '../_features/analysis-view/ui/analysis-workspace';
import { TimeSeriesPanel } from '../_features/time-series/ui/time-series-panel';
import { AnalysisHeader } from './analysis-header';
import type { TimeSeriesView } from '../_features/time-series/model/present-time-series';
import {
  AnalysisContext,
  AnalysisHistoryPending,
  AnalysisPendingPlot,
  type AnalysisSampleCounts
} from './analysis-evidence';

/**
 * 화면에 낼 표본 수다. 그린 그림이 없어도 조건에 맞는 관측이 0건이라는 **사실**은 있으므로 그때도
 * 수를 낸다. 아직 발행되지 않은 자료만 미확인이다(AGENTS 3).
 */
function sampleCountsOf(view: TimeSeriesView | null): AnalysisSampleCounts | null {
  if (view === null) return null;
  if (view.kind === 'plot') {
    return { target: view.plot.targetCount, comparison: view.plot.comparisonCount };
  }
  if (view.kind === 'empty') return { target: view.targetCount, comparison: view.comparisonCount };
  return null;
}

export function AnalysisScreen({
  data
}: {
  readonly data: NonNullable<Awaited<ReturnType<typeof loadAnalysisPage>>>;
}) {
  const context = presentAnalysisContext(data.setup, data.applied);
  return (
    <AnalysisWorkspace
      header={<AnalysisHeader header={data.header} />}
      filters={
        <AnalysisFilters
          key={data.applied.key ?? 'initial'}
          setup={data.setup}
          applied={data.applied}
        />
      }
      reset={<AnalysisResetButton />}
      context={
        <AnalysisResultsGate requestKey={data.applied.key}>
          <AnalysisContext
            context={context}
            samples={sampleCountsOf(data.timeSeries)}
          />
        </AnalysisResultsGate>
      }
      time={
        <AnalysisResultsGate requestKey={data.applied.key}>
          {data.timeSeries === null || context.state === 'invalid' ? (
            <AnalysisPendingPlot kind='time' />
          ) : (
            <TimeSeriesPanel
              view={data.timeSeries}
              organizationLabel={context.organization}
              comparisonLabel={`${context.comparison} 전체`}
            />
          )}
        </AnalysisResultsGate>
      }
      distribution={
        <AnalysisResultsGate requestKey={data.applied.key}>
          <AnalysisPendingPlot kind='distribution' />
        </AnalysisResultsGate>
      }
      history={
        <AnalysisResultsGate requestKey={data.applied.key}>
          <AnalysisHistoryPending />
        </AnalysisResultsGate>
      }
    />
  );
}
