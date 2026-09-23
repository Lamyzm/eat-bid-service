/** @module 책임: 시간축 표시 모델의 갈래마다 무엇을 보여줄지 고르고 그림은 캔버스 잎에 맡긴다. */
import type { TimeSeriesView } from '../model/present-time-series';
import { TimeSeriesChart } from './time-series-chart';

function Notice({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <div className='analysis-empty-plot'>
      <div className='max-w-sm'>
        <h3 className='text-base font-semibold'>{title}</h3>
        <p className='mt-3 text-sm leading-relaxed text-muted-foreground'>{description}</p>
      </div>
    </div>
  );
}

export function TimeSeriesPanel({
  view,
  organizationLabel,
  comparisonLabel
}: {
  readonly view: TimeSeriesView;
  readonly organizationLabel: string;
  readonly comparisonLabel: string;
}) {
  switch (view.kind) {
    // 사용자가 할 일이 갈래마다 다르다. 조건을 고쳐야 하는 것과 기다려야 하는 것과 범위를 넓혀야
    // 하는 것을 한 문구로 뭉치면 무엇을 해야 할지 알 수 없다.
    case 'cohort-not-found':
      return (
        <Notice
          title='이 조건의 모집단을 찾을 수 없어요'
          description='고른 기관이나 지역이 더 이상 없어요. 비교조건을 다시 선택해 주세요.'
        />
      );
    case 'unavailable':
      return <Notice title='아직 보여드릴 수 없어요' description={view.reason} />;
    /*
      조건을 고치라고 하지 않는다. 사용자가 고른 조건에는 잘못이 없고, 지금 할 수 있는 일은 기다렸다
      다시 여는 것뿐이다. 위 공고 정보와 조건 막대는 그대로 서 있으므로 화면이 사라지지 않는다.
    */
    case 'read-failed':
      return (
        <Notice
          title='그림을 불러오지 못했어요'
          description='잠시 뒤 다시 열어 주세요. 조건은 그대로 두셔도 돼요.'
        />
      );
    case 'empty':
      return (
        <Notice
          title='조건에 맞는 개찰 기록이 없어요'
          description='기간을 넓히거나 명단·품목 조건을 풀면 기록이 나올 수 있어요.'
        />
      );
    case 'plot':
      return (
        <TimeSeriesChart
          plot={view.plot}
          organizationLabel={organizationLabel}
          comparisonLabel={comparisonLabel}
        />
      );
  }
}
