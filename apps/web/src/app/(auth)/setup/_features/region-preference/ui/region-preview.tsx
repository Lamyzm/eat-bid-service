/**
 * @module 책임: 저장하기 전 이 선택이 오늘 몇 건을 잡고 몰리는 날에는 몇 건이었는지를 실제 조회 결과로
 * 보여 준다.
 */
'use client';

import { useQuery } from '@tanstack/react-query';

import { eligibilityAreaQueries } from '@/api/eligibility-areas';
import { Skeleton } from '@/shared/ui/skeleton';

const NUMBER = 'text-2xl font-bold tabular-nums';
const CAPTION = 'text-[13px] font-semibold text-muted-foreground';

/**
 * 오늘 건수만 보여 주면 이 제품이 쓸모없어 보인다. 90일 실측에서 공고가 있던 날은 3분의 1이었고 아흐레가
 * 63%를 차지했다 — 사용자가 화면을 여는 날은 성수기 하루다. 그래서 오늘과 몰리는 날 최대를 같은 자리에
 * 나란히 둔다. 숫자는 전부 서버 조회에서 온다.
 */
export function RegionPreview({ codeValueIds }: { readonly codeValueIds: readonly string[] }) {
  const coverage = useQuery(eligibilityAreaQueries.coverage(codeValueIds));

  if (coverage.isPending) return <Skeleton className='h-28 w-full' />;
  if (coverage.isError || coverage.data === undefined) {
    // 못 읽은 것을 0으로 바꾸지 않는다. 그러면 화면이 없는 사실을 말한다.
    return <p className='text-sm text-muted-foreground'>지금은 결과를 미리 보여 드리지 못합니다.</p>;
  }

  const { today, window } = coverage.data;
  return (
    <div className='grid gap-3 rounded-lg bg-muted/40 p-4'>
      <p className='text-[15px] leading-relaxed'>
        오늘은 <b>{today.matchedCount}건</b>
        {window.peakDay === null
          ? '입니다.'
          : <> 이지만, 공고가 몰리는 날은 <b>{window.peakDay.count}건</b>까지 갑니다.</>}
      </p>
      <div className='flex flex-wrap gap-x-8 gap-y-3 border-t pt-3'>
        <div>
          <div className={CAPTION}>오늘 열린 것</div>
          <div className={NUMBER}>
            {today.matchedCount}
            <span className={`ml-1.5 ${CAPTION}`}>전국 {today.nationwideCount}건 중</span>
          </div>
        </div>
        <div>
          <div className={CAPTION}>몰리는 날 최대</div>
          <div className={NUMBER}>
            {window.peakDay?.count ?? 0}
            <span className={`ml-1.5 ${CAPTION}`}>{window.peakDay?.date ?? '지난 90일 관측 없음'}</span>
          </div>
        </div>
        <div>
          <div className={CAPTION}>공고가 있던 날</div>
          <div className={NUMBER}>
            {window.daysWithAuctions}
            <span className={`ml-1.5 ${CAPTION}`}>90일 중</span>
          </div>
        </div>
        <div>
          {/* 제한지역을 관측하지 못한 공고는 감추지 않는다. 숨기면 낼 수 있는 공고가 사라진다. */}
          <div className={CAPTION}>제한지역 미관측</div>
          <div className={NUMBER}>
            {today.unobservedCount}
            <span className={`ml-1.5 ${CAPTION}`}>목록에 함께</span>
          </div>
        </div>
      </div>
      <p className='text-[13px] leading-relaxed text-muted-foreground'>
        지난 90일 중 {90 - window.daysWithAuctions}일은 낼 공고가 없었습니다. 이 일은 매일 하는 일이 아니라
        몰리는 며칠에 하는 일입니다. 공고가 뜨면 알려 드리는 편이 낫겠지만 그건 아직 없습니다.
      </p>
    </div>
  );
}
