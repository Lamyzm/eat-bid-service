/** @module 책임: 왼쪽 기둥의 조건 세 구역(지역·품목·기초금액)을 표시 모델이 준 줄 그대로 링크·GET form으로 그린다. 무엇을 걸지는 주소가, 몇 건인지는 요약이 말하고 여기는 server component로 남는다. */
import Link from 'next/link';

import type { ConditionRailPresentation, RailRow } from '../model/present-condition-rail';

// 구역 머리는 12px 회색 한 줄이고 구역 사이는 선 하나로 갈린다(U9, 사용자 결정 2026-09-17).
export const RAIL_HEAD = 'px-2 text-[12px] font-semibold text-muted-foreground/70';
export const RAIL_SECTION = 'grid min-w-0 gap-0.5 border-t border-border pt-5';
const ROW = 'flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-[15px]';
const LINK = 'inline-flex h-7 items-center rounded-lg px-2 text-[13px] font-semibold text-muted-foreground hover:bg-foreground/5';

/**
 * 체크 줄 하나다. **주소가 바뀌는 조작이라 체크박스가 아니라 링크다** — 새 탭 열기와 주소 공유가 그대로
 * 살고 화면이 브라우저로 넘어가지 않는다. 고른 상태는 `aria-current`가 말하고 네모는 그림일 뿐이다.
 */
function CheckRow({ row }: { readonly row: RailRow }) {
  const box = (
    <span
      aria-hidden
      className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] ${row.active ? 'bg-primary' : 'bg-secondary'}`}
    >
      {row.active ? (
        <svg viewBox='0 0 12 12' className='size-3 text-primary-foreground' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
          <path d='M2.5 6.5 5 9l4.5-6' />
        </svg>
      ) : null}
    </span>
  );
  const count = (
    <span className={`ml-auto text-[14px] tabular-nums ${row.active ? 'font-bold text-primary' : 'text-muted-foreground/70'}`}>{row.countText}</span>
  );
  const body = (
    <>
      {box}
      <span className='min-w-0 flex-1 truncate'>{row.label}</span>
      {count}
    </>
  );
  if (row.href === null) {
    return <span className={`${ROW} font-medium text-muted-foreground`}>{body}</span>;
  }
  return (
    <Link
      href={row.href}
      aria-current={row.active ? 'true' : undefined}
      className={`${ROW} ${row.active ? 'font-bold text-foreground' : 'font-medium text-sidebar-foreground hover:bg-foreground/5'}`}
    >
      {body}
    </Link>
  );
}

/**
 * 지역 구역이다. 시도는 하나만 고르고 시군구는 그 시도 안에서 여럿을 켠다.
 *
 * **시도 목록을 접지 않는다**(사용자 결정 2026-09-17). 접어 두면 고른 시도 하나만 보이고 나머지 열여덟이
 * 삼각형 뒤로 숨는다. 지역을 자주 바꾸지 않더라도 **어떤 지역이 있는지가 안 보이는 것**이 문제다 — 화면이
 * "경남밖에 없다"고 말하는 것처럼 읽힌다. 기본으로 어느 지역을 볼지는 저장된 관심 지역이 정하고, 그것과
 * 목록을 펼쳐 두는 것은 다른 문제다.
 *
 * 목록이 길어지는 것은 받아들인다. 어휘 전체가 0건까지 서는 것이 이 축의 계약이고(§10.4), 기둥은 `xl`에서
 * 자기 스크롤을 가지므로 길이가 본문을 밀지 않는다.
 */
function RegionSection({ region }: { readonly region: ConditionRailPresentation['region'] }) {
  return (
    <div role='group' aria-label='지역' className={RAIL_SECTION}>
      <span className={RAIL_HEAD}>지역</span>
      <div className='grid gap-0.5'>
        {region.sidoRows.map((row) => (
          <Link
            key={row.key}
            href={row.href!}
            aria-current={row.active ? 'true' : undefined}
            className={`${ROW} ${row.active ? 'bg-accent font-bold text-accent-foreground' : 'font-medium hover:bg-foreground/5'}`}
          >
            <span className='min-w-0 flex-1 truncate'>{row.label}</span>
            <span className='text-[14px] tabular-nums text-muted-foreground/70'>{row.countText}</span>
          </Link>
        ))}
      </div>
      {region.sigunguRows.map((row) => <CheckRow key={row.key} row={row} />)}
      {/* 지역 미상은 품목 미상과 같은 줄이다. 시도를 골랐을 때만 링크가 되고, 그 전에는 수만 말한다. */}
      <CheckRow row={region.unknownRow} />
      {region.gate === null ? null : (
        // 게이트(내 참가제한지역)는 목록 전체에 걸리는 설정이라 여기서는 넓히거나 바꾸는 손잡이만 작게 둔다.
        // 이것은 필터이지 자격 판정이 아니다. `낼 수 있는 공고`라고 적지 않는다(ADR 0048 결정 5).
        <span className='flex flex-wrap gap-1 pt-1' title={region.gate.text}>
          {region.gate.links.map((link) => (
            <Link key={link.label} href={link.href as '/today'} className={LINK}>{link.label}</Link>
          ))}
        </span>
      )}
    </div>
  );
}

function ItemSection({ item }: { readonly item: ConditionRailPresentation['item'] }) {
  return (
    <div role='group' aria-label='품목' className={RAIL_SECTION}>
      <span className={RAIL_HEAD}>품목</span>
      {/* 여덟 원자 전부가 0까지 선다. 묶음(`축산`)은 두지 않는다 — 어휘에 넣는 순간 그 정의를 우리가 소유한다. */}
      {item.rows.map((row) => <CheckRow key={row.key} row={row} />)}
      <CheckRow row={item.unknownRow} />
    </div>
  );
}

/**
 * 기초금액은 최소 한 칸이고 기본이 비어 있다(사용자 결정 2026-09-15). 경계는 사용자가 긋고 우리는
 * 눈금·프리셋을 두지 않는다. `details` 없는 GET form이라 이 화면이 server component로 남고, 지금 걸린 다른
 * 조건은 hidden으로 함께 보내야 금액만 바꿨을 때 나머지가 조용히 풀리지 않는다. 버튼은 없다 — Enter가
 * 제출이고 시안에도 없다(EAT-248 판정, 사용자 결정 2026-09-17).
 */
function AmountSection({ amount }: { readonly amount: ConditionRailPresentation['amount'] }) {
  return (
    // 이 구역의 이름은 입력의 `label`이 이미 갖는다. form에 같은 이름을 한 번 더 주면 이름이 두 자리에 산다.
    <form method='get' action='/today' className={`${RAIL_SECTION} gap-1.5`}>
      {amount.carried.map(({ key, value }) => <input key={key} type='hidden' name={key} value={value} />)}
      <label htmlFor='today-base-amount-min' className={RAIL_HEAD}>기초금액</label>
      <input
        id='today-base-amount-min'
        name='baseAmountMin'
        type='text'
        inputMode='numeric'
        defaultValue={amount.valueText}
        placeholder='하한 없음'
        className='h-[46px] w-full rounded-lg bg-muted px-3 text-[16px] font-semibold tabular-nums placeholder:font-medium placeholder:text-muted-foreground/70'
      />
      {amount.clearHref === null ? null : (
        <Link href={amount.clearHref} className='justify-self-end pt-2 text-[14px] font-semibold text-muted-foreground hover:underline'>기본값으로</Link>
      )}
    </form>
  );
}

export function ConditionRail({ rail }: { readonly rail: ConditionRailPresentation }) {
  return (
    // 기둥이 본문 위로 가는 폭(xl 미만)에서는 세 구역이 가로로 선다. 세로로 쌓으면 목록이 첫 화면 밖으로 밀린다.
    <div className='grid min-w-0 items-start gap-5 md:grid-cols-3 xl:grid-cols-1'>
      {/*
        건수를 못 셌다는 말은 구역 셋 위에 한 번만 둔다. 지역 줄이 통째로 비는 것이 여기서만 보이므로
        머리의 알림으로는 닿지 않는다 — 기둥은 본문과 다른 칸에 있다.
      */}
      {rail.note === null ? null : (
        <p className='text-[13px] font-medium text-muted-foreground md:col-span-3 xl:col-span-1'>{rail.note}</p>
      )}
      <RegionSection region={rail.region} />
      <ItemSection item={rail.item} />
      <AmountSection amount={rail.amount} />
    </div>
  );
}
