/** @module 책임: 열린 공고 행을 마감 시각 묶음 아래 세 줄 카드(기관·품목 / 제목·공고번호 / 지금·지난번·보통)와 오른쪽 금액·하한으로 그린다. 무엇을 묶고 어떤 글자를 쓸지는 표시 모델이 정하고 여기는 server component로 남는다. */
import Link from 'next/link';

import { summarizeItemLabel } from '@/entities/item/item-label';

import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { ClosingDayGroup, ClosingSlotGroup } from '../_model/group-closing-slots';
import type { ClosesTone, OpenAuctionRowPresentation } from '../_model/present-open-auctions';
import { CopyBidNo } from './copy-bid-no';

/**
 * 묶음 머리의 색이다. **상태색(red·amber)을 쓰지 않는다.** §9.2의 amber는 stale·부분 수집에만 쓰는
 * 색이고 마감이 가까운 것은 결손도 사고도 아니라 관측된 일정이다. 실제로 오늘 마감이 0건인 날에는 첫
 * 화면의 묶음 머리 서른 개가 전부 `내일`이라 통째로 amber가 되어, 같은 절이 경고하는 "목록이 경고판이
 * 되고 정말 급한 것이 묻힌다"가 그대로 일어났다(design-judge 반려 2026-09-17).
 *
 * 그래서 §10.4가 정한 색 셋(본문·muted·hint)만으로 거리를 말한다. 오늘과 내일이 본문, 그 뒤는 muted,
 * 지난 묶음은 hint다. 급함은 색이 아니라 `3시간 뒤`·`내일` 글자와 마감 순 정렬이 말하며, 색 이외의
 * 신호가 늘 함께 있어야 한다는 §11도 그 글자가 이미 만족한다.
 */
const CLOSES_TONE: Record<ClosesTone, string> = {
  today: 'text-foreground',
  tomorrow: 'text-foreground',
  later: 'text-muted-foreground',
  unknown: 'text-muted-foreground'
};

// 글자 크기의 위계는 넷뿐이다(U9). 기관 17/700, 금액 19/800, 나머지 본문 14, 묶음 머리 18/800. 색은
// 본문·muted·hint(muted 70%) 세 단이고 굵기가 값과 라벨을 가른다 — 크기를 늘리지 않는다.
const HINT = 'text-muted-foreground/70';
const NUM = 'font-bold text-muted-foreground tabular-nums';

/**
 * 날짜 머리다. **스크롤을 따라 위에 붙는다** — 목록은 한 날에 백 행이 넘게 서므로, 붙어 있지 않으면 몇 줄만
 * 내려도 지금 보는 것이 언제 마감인지가 화면에서 사라진다(사용자 요청 2026-09-17). 셸 머리가 이미 위에
 * 붙어 있으므로 그 높이만큼 내려 앉고, 같은 변수를 셸의 도구 줄도 쓴다.
 *
 * 이 자리가 목록에서 가장 큰 글자다(18/800). 시각 묶음은 그 아래 14/700 muted로 낮춰 두 단이 서로 다른
 * 무게를 갖게 한다 — 둘이 같은 무게면 날짜 경계가 시각 경계와 구분되지 않는다.
 */
function DayHead({ day }: { readonly day: ClosingDayGroup }) {
  return (
    <h3
      data-slot='closes-day'
      className={`sticky top-[var(--workspace-header-height,0px)] z-10 flex items-baseline gap-2.5 border-b border-border bg-background py-2.5 ${day.past ? HINT : ''}`}
    >
      <span className='text-[18px] font-extrabold tracking-[-0.03em]'>{day.dayText}</span>
      {day.awayText === '' ? null : <span className='text-[14px] font-semibold text-muted-foreground'>{day.awayText}</span>}
      <span className={`ml-auto text-[14px] font-semibold tabular-nums ${HINT}`}>{day.count}건</span>
    </h3>
  );
}

/**
 * 시각 묶음 머리다. 시각·남은 시간·건수 한 줄이 그 아래 행들의 마감을 대신 말한다. 날짜는 적지 않는다 —
 * 위의 날짜 머리가 한 번만 말한다.
 */
function SlotHead({ group }: { readonly group: ClosingSlotGroup }) {
  const tone = group.past ? HINT : CLOSES_TONE[group.tone];
  return (
    <div className='mt-5 flex items-baseline gap-2.5 first:mt-3'>
      <span data-slot='closes' className={`text-[14px] font-bold ${tone === 'text-foreground' ? 'text-muted-foreground' : tone}`}>{group.titleText}</span>
      {group.awayText === '' ? null : <span className={`text-[14px] font-semibold ${HINT}`}>{group.awayText}</span>}
      <span className={`ml-auto text-[14px] font-semibold tabular-nums ${HINT}`}>{group.count}건</span>
    </div>
  );
}

/**
 * 셋째 줄이다. 지금 명단 수 · 같은 하한 직전 회차 · 보통(중앙값과 표본)이며 셋 다 eaT가 주지 않는 값이라
 * 이 화면의 값어치가 여기에 있다. 세 절뿐이다 — 직전 회차의 `하한 아래 N`은 표 시절의 값이고 넷째 절로 끼면
 * 시안의 호흡이 무너진다(design-judge 반려 2026-09-17). 그 수는 결정 화면이 말한다. 낙찰 투찰률도 싣지
 * 않는다 — 같은 값이 행마다 서면 앵커링이다(decision-support §11).
 */
function SignalLine({ row }: { readonly row: OpenAuctionRowPresentation }) {
  const summary = row.orgSummary;
  const sep = <span aria-hidden className='mx-[7px] text-border'>·</span>;
  return (
    // 조각(지금·지난번·보통)은 통째로 줄을 바꾼다. 낱말 가운데서 끊기면 `24회 기 / 준`이 된다(1280 실측).
    <p className={`mt-[7px] flex flex-wrap items-baseline gap-y-0.5 text-[14px] ${HINT}`}>
      {/* 참여 0은 `아직 0곳`이다. 기회가 아니라 혼자면 유찰이라는 신호라서 굵게 세우지 않고, 단독입찰을
          허용하지 않는 판이면 그 이유를 옆에 적는다(EAT-249). 허용하는 판과 아직 못 본 판에는 적지 않는다 —
          우리가 모르는 것을 아는 척하지 않는다(AGENTS 3). 못 센 판(`—`)은 0과 섞이지 않는다. */}
      {row.bidCountText === '' ? (
        <span className='whitespace-nowrap'>
          아직 <span className='tabular-nums'>0곳</span>
          {row.soloBid === 'not-allowed' ? <span className='font-medium'> (혼자면 유찰)</span> : null}
        </span>
      )
        : row.bidCountText === '—' ? <span className='whitespace-nowrap'>참여 미관측</span>
        : <span className='whitespace-nowrap'>지금 <b className='font-bold text-foreground tabular-nums'>{row.bidCountText}곳</b></span>}
      {summary === null ? null : (
        <>
          {sep}
          {summary.lastRound.kind === 'observed' ? (
            <span className='whitespace-nowrap'>
              지난번 <span className={NUM}>{summary.lastRound.listText}</span>{' '}
              <span className='font-medium'>({summary.lastRound.dateText})</span>
            </span>
          ) : <span className='whitespace-nowrap'>지난번 {summary.lastRound.text}</span>}
          {sep}
          {/* 표본 수를 함께 적는다 — 같은 `보통 52곳`이라도 다섯 회와 스물두 회는 무게가 다르다(AGENTS 7). */}
          <span className='whitespace-nowrap'>
            보통 <span className={NUM}>{summary.medianListText === '—' ? '—' : `${summary.medianListText}곳`}</span>{' '}
            <span className='font-medium'>{summary.listCountSampleCount}회 기준</span>
          </span>
        </>
      )}
    </p>
  );
}

/**
 * 행 하나다. 왼쪽 세 줄과 오른쪽 금액이다. 행을 여는 자리는 기관 이름이고 결정 화면을 가리킨다 — 별도의
 * `열기`를 두면 모든 행에 같은 단어가 서른 번 선다. 품목 링크는 라벨 전체가 아니라 첫 조각 하나를 건다 —
 * 합성 라벨을 통째로 걸면 `육류`만 있는 행이 빠진다(EAT-230). 지역은 행에 없다 — 기둥이 소유하는 축이고
 * 행마다 적으면 같은 글자가 스무 번 선다(U9).
 */
/** 게시 종류가 행에 적는 말이다. 일반공고와 미관측은 아무것도 적지 않는다(EAT-262). */
const CHANGE_KIND_TEXT: Readonly<Record<OpenAuctionRowPresentation['changeKind'], string | null>> = {
  rebid: '재입찰',
  amended: '변경공고',
  regular: null,
  unknown: null
};

function AuctionRow({ row, search }: { readonly row: OpenAuctionRowPresentation; readonly search: TodaySearch }) {
  const item = row.itemLabel === null ? null : summarizeItemLabel(row.itemLabel);
  return (
    <article
      data-slot='auction-row'
      data-closes={row.closes.tone}
      // 음수 여백으로 행을 본문 밖으로 내밀지 않는다. 14px 내민 행이 부모의 scrollWidth를 늘려 폭별 밀림 검사가 넘침으로
      // 읽는다(CI 실측 906>892). hover 면은 글자 가장자리에서 시작한다.
      className='grid gap-x-6 gap-y-2 rounded-xl py-4 hover:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_200px] [&+&]:shadow-[inset_0_1px_0_var(--border)]'
    >
      <div className='min-w-0'>
        <p className='flex min-w-0 flex-wrap items-baseline gap-x-2'>
          <Link
            href={row.href}
            // 띄어쓰기 없는 긴 기관명(복지관·납품업체선정 등 30자)이 md(768)에서 칸을 넘친다. 낱말 단위로 접되
            // 한 낱말이 칸보다 길면 그 안에서 끊는다(CI 폭별 밀림 실측 364>240).
            className={`min-w-0 break-keep wrap-anywhere text-[17px] font-bold tracking-[-0.025em] hover:underline ${row.organization.tone === 'named' ? '' : 'text-muted-foreground'}`}
          >
            {row.organization.text}
          </Link>
          {item === null ? <span className={`text-[14px] font-medium ${HINT}`}>품목 모름</span> : (
            <span title={item.full ?? undefined} className='text-[14px] font-semibold text-muted-foreground'>
              <Link href={buildTodayFilterRoute(search, { items: [item.parts[0]!] })} className='hover:underline'>{item.parts[0]}</Link>
              {item.parts.length > 1 ? ` 외 ${item.parts.length - 1}` : ''}
            </span>
          )}
        </p>
        <p className='mt-1 flex min-w-0 items-baseline gap-x-2 text-[14px] text-muted-foreground'>
          {/* 제목은 잘라 내지 않고 접는다. 말줄임(overflow hidden)은 좁은 폭에서 글자를 숨기고 폭별 밀림 검사도
              그것을 넘침으로 읽는다(CI 실측 349>162). 넓은 폭에서는 한 줄이고 좁은 폭에서만 두 줄이 된다. 상세를
              아직 따지 않은 공고는 제목이 없고 그 사실을 적는다 — 빈칸은 "제목이 없다"로 읽힌다(AGENTS 3). */}
          <span className={`min-w-0 break-keep wrap-anywhere ${row.title === null ? HINT : ''}`}>{row.title ?? '제목 미관측'}</span>
          {/* 공고번호는 eaT로 건너가는 손잡이다. 마지막 한 걸음은 늘 "이 판을 eaT에서 연다"이다(EAT-248). */}
          {row.displayBidNo === null ? null : <span className='shrink-0 text-[13px]'><CopyBidNo value={row.displayBidNo} /></span>}
          {/* 제한지역은 공고지역과 다른 축이라 링크가 아니라 사실 표시다. 관측하지 못한 경우만 남긴다 — 제한
              없음으로 바꿔 적으면 낼 수 있는 공고가 목록에서 조용히 사라진다. 급한 일이 아니라 사실이라 색이
              아니라 굵기로 드러낸다. */}
          {row.eligibilityText === null ? <span className='shrink-0 font-semibold text-foreground'>제한지역 미관측</span> : null}
          {/* 게시 종류는 원천이 말한 사실이라 링크가 아니다. 재입찰이면 이 판은 한 번 유찰되고 다시 열린
              판이고, 변경공고면 같은 차수를 고쳐 다시 낸 것이다 — 셋째 줄의 `지난번`을 다르게 읽게 만든다.
              일반공고(97%)와 미관측에는 아무것도 적지 않는다: 97%에 붙는 표시는 신호가 아니라 배경이고,
              모르는 것을 아는 척하지 않는다(AGENTS 3, EAT-262). 급한 일이 아니라 사실이라 색이 아니라 굵기다. */}
          {CHANGE_KIND_TEXT[row.changeKind] === null ? null : (
            <span className='shrink-0 font-semibold text-foreground'>{CHANGE_KIND_TEXT[row.changeKind]}</span>
          )}
        </p>
        <SignalLine row={row} />
      </div>
      <div className='sm:text-right'>
        <p className='text-[19px] font-extrabold tracking-[-0.03em] tabular-nums'>
          {row.baseAmountText}
          {row.baseAmountText === '미확인' ? null : <span className='ml-0.5 text-[15px] font-bold'>원</span>}
        </p>
        {/* 하한은 열이 아니라 금액 아래 한 줄이다. 눈금이 다른 낙찰 투찰률은 여기 없다(PDR-0004). */}
        <p className='mt-1 text-[14px] font-semibold text-muted-foreground tabular-nums'>
          {row.floorRateText === '미확인' ? '하한 미확인' : `하한 ${row.floorRateText}%`}
        </p>
      </div>
    </article>
  );
}

/**
 * 행 값은 서버에서 이미 문자열로 만들어졌고 행 안 상호작용은 링크와 복사 손잡이뿐이라 목록은 server
 * component다. 괘선은 행 사이 1px 안쪽 선 하나이고, 날짜가 바뀌는 자리는 붙어 따라오는 날짜 머리가 가른다.
 */
export function OpenAuctionCards({ days, search }: { readonly days: readonly ClosingDayGroup[]; readonly search: TodaySearch }) {
  return (
    <div className='min-w-0'>
      {days.map((day) => (
        <section key={day.key} aria-label={day.dayText} className={`mt-7 first:mt-0 ${day.past ? 'opacity-60' : ''}`}>
          <DayHead day={day} />
          {day.slots.map((group) => (
            // 보이는 글자에서 날짜를 뺐으므로 접근 이름에는 붙인다. 다른 날 같은 시각 묶음이 둘이면
            // 이름이 같은 구획이 형제로 서서 낭독기가 어느 쪽인지 말하지 못한다.
            <section key={group.key} aria-label={`${day.dayText} ${group.titleText}`}>
              {/* 마감을 관측하지 못한 묶음은 나눌 시각이 없다. 날짜 머리가 이미 `마감 미확인`이라 말했으므로
                  같은 말을 한 줄 더 적지 않는다 — 두 단이 같은 문장이면 단이 둘인 이유가 사라진다. */}
              {group.key === 'unknown' ? null : <SlotHead group={group} />}
              <div className='mt-1.5'>
                {group.rows.map((row) => <AuctionRow key={row.auctionAttemptId} row={row} search={search} />)}
              </div>
            </section>
          ))}
        </section>
      ))}
    </div>
  );
}
