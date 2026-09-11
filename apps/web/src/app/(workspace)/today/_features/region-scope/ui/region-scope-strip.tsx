/**
 * @module 책임: 오늘 목록 위에 "무엇으로 좁혔는지"를 계속 보이게 하고 전체 보기·설정 바꾸기 출구를 둔다.
 */
import Link from 'next/link';

import { ALL_REGIONS_SCOPE, buildTodayFilterRoute, type TodaySearch } from '@/app/(workspace)/today/_lib/today-search-params';
import type { TodayRegionGate } from '@/app/(workspace)/today/_model/load-today-page';

const LINK = 'inline-flex h-8 items-center rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold hover:bg-foreground/10';
const PILL = 'inline-flex h-7 items-center rounded-full bg-primary/10 px-3 text-[13px] font-semibold text-primary';

/**
 * 지역 이름을 문자열로 조립해 키로 쓰지 않는다. 정체성은 `codeValueId`이고 이름은 사람이 확인할 표시값일
 * 뿐이며, 라벨이 관측되지 않은 코드는 코드 문자열로 부른다(AGENTS 2, ADR 0035).
 */
function areaText(area: { readonly code: string; readonly label: string | null }): string {
  return area.label ?? `코드 ${area.code}`;
}

/**
 * 이것은 필터이지 자격 판정이 아니다. `낼 수 있는 공고`가 아니라 `내가 고른 지역의 공고`라고 적는 이유는
 * 지역만으로 참가 자격이 정해지지 않기 때문이다 — 업종·실적·제한경쟁 조건은 사용자가 직접 확인한다
 * (screen-system §5.1, ADR 0048 결정 5).
 */
export function RegionScopeStrip({
  gate,
  search,
  matchedCount,
  unobservedCount
}: {
  readonly gate: TodayRegionGate;
  readonly search: TodaySearch;
  readonly matchedCount: number | null;
  readonly unobservedCount: number | null;
}) {
  if (gate.kind === 'unknown' || gate.kind === 'unset') return null;
  const applied = gate.kind === 'applied';
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-card px-4 py-3 shadow-xs'>
      <span className='text-[15px] font-bold'>
        {applied ? '내가 고른 지역의 공고' : '전국 공고'}
      </span>
      {gate.areas.length === 0 ? (
        <span className='text-[13px] font-semibold text-muted-foreground'>고른 지역 없음</span>
      ) : (
        <span className='flex min-w-0 flex-wrap gap-1.5'>
          {gate.areas.map((area) => (
            <span key={area.codeValueId} className={PILL}>{areaText(area)}</span>
          ))}
        </span>
      )}
      {applied && matchedCount !== null ? (
        <span className='text-[13px] font-semibold text-muted-foreground'>
          {matchedCount}건
          {unobservedCount !== null && unobservedCount > 0 ? ` · 제한지역 미관측 ${unobservedCount}건 포함` : ''}
        </span>
      ) : null}
      <span className='ml-auto flex flex-wrap gap-2'>
        {applied ? (
          <Link href={buildTodayFilterRoute(search, { scope: ALL_REGIONS_SCOPE })} className={LINK}>전체 보기</Link>
        ) : (
          <Link href={buildTodayFilterRoute(search, { scope: null })} className={LINK}>내 지역만 보기</Link>
        )}
        <Link href='/setup?return=%2Ftoday' className={LINK}>지역 바꾸기</Link>
      </span>
    </div>
  );
}

/**
 * 지역을 아직 확인하지 않은 워크스페이스가 보는 화면이다. 목록을 대신하며, 전국 목록을 미리 보여 주고
 * 설정을 권하지 않는다 — 사장님이 낼 수 없는 공고를 걸러내는 것이 이 화면의 첫 번째 일이다.
 */
export function RegionSetupRequest() {
  return (
    <div className='grid gap-3 rounded-xl bg-card px-5 py-6 shadow-xs'>
      <h2 className='text-xl font-bold'>먼저 지역을 고르세요</h2>
      <p className='text-[15px] leading-relaxed text-muted-foreground'>
        공고는 참가할 수 있는 지역을 제한합니다. 배달 다니는 범위를 고르면 그 지역의 공고만 보여 드립니다.
        지금은 전국 공고가 전부 쏟아져 낼 수 없는 공고를 사장님이 직접 걸러 내야 합니다.
      </p>
      <div>
        <Link
          href='/setup?return=%2Ftoday'
          className='inline-flex h-10 items-center rounded-lg bg-primary px-4 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90'
        >
          내 지역 고르기
        </Link>
      </div>
    </div>
  );
}
