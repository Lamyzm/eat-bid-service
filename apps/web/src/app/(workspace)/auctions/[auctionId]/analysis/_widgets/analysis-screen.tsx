/** @module 책임: 새 상세 전용 공고·공통 조건·분석 준비 영역을 조립하며 이전 상세 화면에는 의존하지 않는다. */
import type { loadAnalysisPage } from '../_lib/load-analysis-page';
import { presentAnalysisContext } from '../_features/analysis-filters/model/present-analysis-context';
import { AnalysisFilters } from '../_features/analysis-filters/ui/analysis-filters';
import { AnalysisResultsGate } from '../_features/analysis-filters/ui/analysis-results-gate';
import { AnalysisWorkspace } from '../_features/analysis-view/ui/analysis-workspace';
import { AnalysisHeader } from './analysis-header';
import { AnalysisContext, AnalysisHistoryPending, AnalysisPendingPlot } from './analysis-evidence';

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
      context={
        <AnalysisResultsGate requestKey={data.applied.key}>
          <AnalysisContext context={context} />
        </AnalysisResultsGate>
      }
      time={
        <AnalysisResultsGate requestKey={data.applied.key}>
          <AnalysisPendingPlot kind='time' />
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
