/** @module 책임: 왼쪽 기둥의 조건 세 구역(지역·품목·기초금액)을 표시 모델이 준 줄 그대로 링크·GET form으로 그린다. 무엇을 걸지는 주소가, 몇 건인지는 요약이 말하고 여기는 server component로 남는다. */
import Link from 'next/link';

import type { ConditionRailPresentation, RailRow } from '../model/present-condition-rail';

const HEAD = 'px-2.5 text-[13px] font-medium text-muted-foreground';
const ROW = 'flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[15px]';
const LINK = 'inline-flex h-7 items-center rounded-lg bg-foreground/5 px-2.5 text-[13px] font-semibold hover:bg-foreground/10';

/**
 * 체크 줄 하나다. **주소가 바뀌는 조작이라 체크박스가 아니라 링크다** — 새 탭 열기와 주소 공유가 그대로
 * 살고 화면이 브라우저로 넘어가지 않는다. 고른 상태는 `aria-current`가 말하고 네모는 그림일 뿐이다.
 */
function CheckRow({ row }: { readonly row: RailRow }) {
  const box = (
    <span
      aria-hidden
      className={`size-4 shrink-0 rounded border ${row.active ? 'border-primary bg-primary' : 'border-border bg-background'}`}
    />
  );
  const body = (
    <>
      {box}
      <span className='min-w-0 flex-1 truncate'>{row.label}</span>
      <span className={`tabular-nums ${row.countText === '' ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>{row.countText}</span>
    </>
  );
  if (row.href === null) {
    return <span className={`${ROW} font-medium text-muted-foreground`}>{body}</span>;
  }
  return (
    <Link
      href={row.href}
      aria-current={row.active ? 'true' : undefined}
      className={`${ROW} ${row.active ? 'font-semibold text-primary' : 'font-medium hover:bg-foreground/5'}`}
    >
      {body}
    </Link>
  );
}

/**
 * 지역 구역이다. 시도는 하나만 고르므로 목록을 접어 두고(`details`), 시군구는 그 시도 안에서 여럿을 켠다.
 * 시군구 목록은 활성 build에서 관측된 짝뿐이라 0건인 시군구는 애초에 없다.
 */
function RegionSection({ region }: { readonly region: ConditionRailPresentation['region'] }) {
  return (
    <div role='group' aria-label='지역' className='grid min-w-0 gap-0.5'>
      <span className={HEAD}>지역</span>
      <details className='group px-2.5 py-1'>
        <summary className='flex cursor-pointer list-none items-center justify-between rounded-lg bg-foreground/5 px-3 py-2 text-[15px] font-semibold'>
          <span>{region.sidoText}</span>
          <span aria-hidden className='text-muted-foreground'>▾</span>
        </summary>
        <div className='mt-1 grid gap-0.5'>
          {region.sidoRows.map((row) => (
            <Link
              key={row.key}
              href={row.href!}
              aria-current={row.active ? 'true' : undefined}
              className={`${ROW} ${row.active ? 'bg-primary/10 font-semibold text-primary' : 'font-medium hover:bg-foreground/5'}`}
            >
              <span className='min-w-0 flex-1 truncate'>{row.label}</span>
              <span className='tabular-nums text-muted-foreground'>{row.countText}</span>
            </Link>
          ))}
        </div>
      </details>
      {region.sigunguRows.map((row) => <CheckRow key={row.key} row={row} />)}
      {region.unobservedText === null ? null : (
        <span className={`${ROW} font-medium text-muted-foreground`}>{region.unobservedText}</span>
      )}
      {region.gate === null ? null : (
        <div className='grid gap-1.5 px-2.5 pt-1.5 text-[13px] font-medium text-muted-foreground'>
          {/* 이것은 필터이지 자격 판정이 아니다. `낼 수 있는 공고`라고 적지 않는다(ADR 0048 결정 5). */}
          <span className='break-keep'>{region.gate.text}</span>
          <span className='flex flex-wrap gap-1.5'>
            {region.gate.links.map((link) => (
              <Link key={link.label} href={link.href as '/today'} className={LINK}>{link.label}</Link>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

function ItemSection({ item }: { readonly item: ConditionRailPresentation['item'] }) {
  return (
    <div role='group' aria-label='품목' className='grid min-w-0 gap-0.5'>
      <span className={HEAD}>품목</span>
      {/* 여덟 원자 전부가 0까지 선다. 묶음(`축산`)은 두지 않는다 — 어휘에 넣는 순간 그 정의를 우리가 소유한다. */}
      {item.rows.map((row) => <CheckRow key={row.key} row={row} />)}
      <CheckRow row={item.unknownRow} />
    </div>
  );
}

/**
 * 기초금액은 최소 한 칸이고 기본이 비어 있다(사용자 결정 2026-09-15). 경계는 사용자가 긋고 우리는
 * 눈금·프리셋을 두지 않는다. `details` 없는 GET form이라 이 화면이 server component로 남고, 지금 걸린 다른
 * 조건은 hidden으로 함께 보내야 금액만 바꿨을 때 나머지가 조용히 풀리지 않는다.
 */
function AmountSection({ amount }: { readonly amount: ConditionRailPresentation['amount'] }) {
  return (
    // 이 구역의 이름은 입력의 `label`이 이미 갖는다. form에 같은 이름을 한 번 더 주면 이름이 두 자리에 산다.
    <form method='get' action='/today' className='grid min-w-0 gap-1.5 px-2.5'>
      {amount.carried.map(({ key, value }) => <input key={key} type='hidden' name={key} value={value} />)}
      <label htmlFor='today-base-amount-min' className={`${HEAD} px-0`}>기초금액</label>
      <input
        id='today-base-amount-min'
        name='baseAmountMin'
        type='text'
        inputMode='numeric'
        defaultValue={amount.valueText}
        placeholder='하한 없음'
        className='h-10 w-full rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold tabular-nums'
      />
      <div className='flex items-center gap-1.5'>
        <button type='submit' className='inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90'>
          적용
        </button>
        {amount.clearHref === null ? null : (
          <Link href={amount.clearHref} className={`${LINK} ml-auto`}>기본값으로</Link>
        )}
      </div>
    </form>
  );
}

export function ConditionRail({ rail }: { readonly rail: ConditionRailPresentation }) {
  return (
    // 기둥이 본문 위로 가는 폭(2xl 미만)에서는 세 구역이 가로로 선다. 세로로 쌓으면 목록이 첫 화면 밖으로 밀린다.
    <div className='grid min-w-0 items-start gap-4 md:grid-cols-3 2xl:grid-cols-1'>
      <RegionSection region={rail.region} />
      <ItemSection item={rail.item} />
      <AmountSection amount={rail.amount} />
    </div>
  );
}
