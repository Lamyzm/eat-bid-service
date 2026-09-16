/** @module 책임: 왼쪽 기둥의 기본 프리셋과 내 프리셋 목록을 건수와 함께 링크로 그리고, 저장·삭제 자리를 그 아래에 둔다. */
import Link from 'next/link';

import type { TodaySearch } from '@/app/(workspace)/today/_lib/today-search-params';
import type { CombinationRowPresentation, CombinationsPresentation } from '@/app/(workspace)/today/_model/present-combinations';

import { DeleteCombinationButton } from './delete-combination-button';
import { SaveCombinationForm } from './save-combination-form';

const ROW = 'flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-[9px] text-[15px]';

/**
 * 줄 하나다. **건수가 이름 옆에 있어야 누르기 전에 몇 건인지 보인다** — 그것이 프리셋의 값어치다.
 *
 * 못 센 수는 0이 아니라 비운다. 0은 "세었는데 없다"이고 빈 자리는 "못 셌다"이며, 0으로 채우면 화면이
 * 저장한 프리셋에 공고가 없다고 거짓말한다(AGENTS 3).
 */
function CombinationRow({ row }: { readonly row: CombinationRowPresentation }) {
  return (
    <div className='group flex min-w-0 items-center'>
      <Link
        href={row.href}
        aria-current={row.active ? 'true' : undefined}
        className={`${ROW} min-w-0 flex-1 ${row.active ? 'bg-accent font-bold text-accent-foreground' : 'font-medium text-sidebar-foreground hover:bg-foreground/5'}`}
      >
        <span className='min-w-0 flex-1 truncate'>{row.name}</span>
        <span className={`text-[14px] tabular-nums ${row.active ? 'font-bold text-primary' : 'text-muted-foreground/70'}`}>
          {row.count ?? ''}
        </span>
      </Link>
      {row.filterCombinationId === null
        ? null
        : <DeleteCombinationButton filterCombinationId={row.filterCombinationId} name={row.name} />}
    </div>
  );
}

/**
 * 프리셋 기둥이다. 기본 셋과 내 프리셋을 나눠 두는 이유는 **지울 수 있는 것이 다르기 때문**이다. 기본 셋은
 * 저장된 것이 아니라 사용자의 기본 필터에서 매번 파생하는 틀이라 지울 것이 없고, 지역을 바꾸면 따라
 * 바뀐다. 내 프리셋만 다섯이 상한이다.
 */
export function CombinationRail({
  combinations,
  search
}: {
  readonly combinations: CombinationsPresentation;
  readonly search: TodaySearch;
}) {
  const full = combinations.saved.length >= combinations.savedLimit;
  return (
    <div className='grid min-w-0 gap-0.5'>
      <span className='px-2 text-[12px] font-semibold text-muted-foreground/70'>프리셋</span>
      {combinations.defaults.map((row) => <CombinationRow key={row.key} row={row} />)}
      <span className='mt-5 mb-1 flex items-baseline justify-between px-2 text-[12px] font-semibold text-muted-foreground/70'>
        <span>내 프리셋</span>
        {/* 상한에 걸렸을 때 사과 문장을 쓰지 않는다. `5 / 5`라는 수가 이미 그 말을 한다. */}
        <span className={`tabular-nums ${full ? 'font-bold text-primary' : ''}`}>
          {combinations.saved.length} / {combinations.savedLimit}
        </span>
      </span>
      {combinations.saved.map((row) => <CombinationRow key={row.key} row={row} />)}
      <SaveCombinationForm
        search={search}
        canSave={combinations.canSaveCurrent}
        full={full}
        suggestedName={combinations.suggestedName}
      />
    </div>
  );
}
