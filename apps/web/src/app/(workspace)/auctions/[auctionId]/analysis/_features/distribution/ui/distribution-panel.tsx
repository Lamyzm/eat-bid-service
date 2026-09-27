/** @module 책임: 분포 표시 모델의 갈래마다 무엇을 보일지 고르고, 구간 줄을 두 집단 막대·비중·건수로 그린다. */
import type { DistributionView } from '../model/present-distribution';

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

export function DistributionPanel({
  view,
  organizationLabel,
  comparisonLabel
}: {
  readonly view: DistributionView;
  readonly organizationLabel: string;
  readonly comparisonLabel: string;
}) {
  switch (view.kind) {
    case 'cohort-not-found':
      return (
        <Notice
          title='이 조건의 모집단을 찾을 수 없어요'
          description='고른 기관이나 지역이 더 이상 없어요. 비교조건을 다시 선택해 주세요.'
        />
      );
    case 'read-failed':
      return (
        <Notice
          title='분포를 불러오지 못했어요'
          description='잠시 뒤 다시 열어 주세요. 조건은 그대로 두셔도 돼요.'
        />
      );
    case 'unavailable':
      return (
        <Notice
          title='아직 보여드릴 수 없어요'
          description='이 조건의 분석 자료가 아직 만들어지지 않았어요.'
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
        <figure
          className='analysis-distribution px-[var(--analysis-padding)] pb-6'
          aria-label='사정률 구간별 낙찰 분포'
        >
          <h3 className='text-lg font-semibold tracking-tight'>어느 구간에 낙찰값이 모였나요?</h3>
          <p className='mt-1 text-xs text-muted-foreground'>
            같은 조건의 과거 낙찰값을 각 집단 전체 건수 대비 비중으로 봅니다. 구간은 하한율에서
            0.1%p씩이에요.
          </p>
          <table className='analysis-distribution-table mt-4'>
            <caption className='sr-only'>
              사정률 구간별 {comparisonLabel} {view.comparisonTotal}건과 {organizationLabel}{' '}
              {view.targetTotal}건의 비중과 건수
            </caption>
            <thead>
              <tr>
                <th scope='col'>사정률 구간(%)</th>
                <th scope='col'>
                  <span className='sr-only'>막대</span>
                </th>
                {/* 머리글은 짧게 둔다. 기관 이름을 머리에 두면 좁은 화면에서 마지막 열이 밀려 잘린다. 이름은 범례가 말한다. */}
                <th scope='col' className='text-right'>
                  비교 대상
                </th>
                <th scope='col' className='text-right'>
                  이 기관
                </th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.key} data-outside={row.outside}>
                  <th scope='row' className='tabular-nums'>
                    {row.label}
                  </th>
                  <td className='analysis-distribution-bars' aria-hidden>
                    <span
                      className='comparison'
                      style={{ width: `${row.comparisonWidth * 100}%` }}
                    />
                    <span className='target' style={{ width: `${row.targetWidth * 100}%` }} />
                  </td>
                  <td className='text-right tabular-nums'>
                    {row.comparisonShareText}
                    <span className='block text-[11px] text-muted-foreground'>
                      {row.comparisonCount.toLocaleString('ko-KR')}건
                    </span>
                  </td>
                  <td className='text-right tabular-nums text-primary'>
                    {row.targetShareText}
                    <span className='block text-[11px] text-muted-foreground'>
                      {row.targetCount.toLocaleString('ko-KR')}건
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <figcaption className='mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground'>
            <span className='flex items-center gap-1.5'>
              <span
                aria-hidden
                className='inline-block h-2 w-4 rounded-sm bg-muted-foreground/40'
              />
              {comparisonLabel} {view.comparisonTotal.toLocaleString('ko-KR')}건
            </span>
            <span className='flex items-center gap-1.5'>
              <span aria-hidden className='inline-block h-2 w-4 rounded-sm bg-primary' />
              {organizationLabel} {view.targetTotal.toLocaleString('ko-KR')}건
            </span>
            <span>맨 위·맨 아래 줄은 구간 밖을 모은 것이라 칸 폭이 달라요.</span>
          </figcaption>
        </figure>
      );
  }
}
