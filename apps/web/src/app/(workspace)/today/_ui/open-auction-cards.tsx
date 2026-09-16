/** @module 책임: 열린 공고 행을 마감 시각 묶음 아래 세 줄 카드(기관·품목 / 제목·공고번호 / 지금·지난번·보통)와 오른쪽 금액·하한으로 그린다. 무엇을 묶고 어떤 글자를 쓸지는 표시 모델이 정하고 여기는 server component로 남는다. */
import Link from 'next/link';

import { summarizeItemLabel } from '@/entities/item/item-label';

import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { ClosingSlotGroup } from '../_model/group-closing-slots';
import type { ClosesTone, OpenAuctionRowPresentation } from '../_model/present-open-auctions';
import { CopyBidNo } from './copy-bid-no';

// 빨강은 상태 색으로만 쓴다. 오늘 마감은 red, 내일 마감은 amber(주의)이며 그 밖의 글자에는 쓰지 않는다
// (screen-system §9.2). 색이 붙는 자리는 묶음 머리 하나다 — 행마다 칠하면 같은 시각 스무 행이 통째로
// 빨개져 임박이 상태가 아니라 배경이 된다. 색과 함께 `N시간 뒤`·`내일` 글자가 같이 있다.
const CLOSES_TONE: Record<ClosesTone, string> = {
  today: 'text-destructive',
  tomorrow: 'text-pushed',
  later: 'text-foreground',
  unknown: 'text-muted-foreground'
};

// 글자 크기의 위계는 넷뿐이다(U9). 기관 17/700, 금액 19/800, 나머지 본문 14, 묶음 머리 18/800. 색은
// 본문·muted·hint(muted 70%) 세 단이고 굵기가 값과 라벨을 가른다 — 크기를 늘리지 않는다.
const HINT = 'text-muted-foreground/70';
const NUM = 'font-bold text-muted-foreground tabular-nums';

/**
 * 묶음 머리다. 시각·남은 시간·건수 한 줄이 그 아래 행들의 마감을 대신 말한다. 날짜가 바뀌는 첫 묶음은
 * 위에 선을 긋고 더 띄운다 — 오늘과 내일 사이가 시각 사이와 같은 간격이면 열 묶음이 한 날로 읽힌다.
 */
function SlotHead({ group }: { readonly group: ClosingSlotGroup }) {
  const tone = group.past ? HINT : CLOSES_TONE[group.tone];
  return (
    <div className={`flex items-baseline gap-2.5 ${group.newDay ? 'mt-9 border-t border-border pt-6' : 'mt-6'} first:mt-0`}>
      <span data-slot='closes' className={`text-[18px] font-extrabold tracking-[-0.03em] ${tone}`}>{group.titleText}</span>
      {group.awayText === '' ? null : <span className={`text-[14px] font-semibold ${group.past ? HINT : 'text-muted-foreground'}`}>{group.awayText}</span>}
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
      {/* 참여 0은 `아직 0곳`이다. 기회가 아니라 혼자면 유찰이라는 신호일 수 있어 굵게 세우지 않는다(EAT-249).
          못 센 판(`—`)은 0과 섞이지 않는다. */}
      {row.bidCountText === '' ? <span className='whitespace-nowrap'>아직 <span className='tabular-nums'>0곳</span></span>
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
            className={`min-w-0 break-keep text-[17px] font-bold tracking-[-0.025em] hover:underline ${row.organization.tone === 'named' ? '' : 'text-muted-foreground'}`}
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
          {/* 제목은 한 줄이다. 두 줄로 흐르면 세 줄 카드가 네 줄이 되어 행마다 높이가 달라진다. 상세를 아직 따지
              않은 공고는 제목이 없고 그 사실을 적는다 — 빈칸은 "제목이 없다"로 읽힌다(AGENTS 3). */}
          <span className={`min-w-0 truncate ${row.title === null ? HINT : ''}`}>{row.title ?? '제목 미관측'}</span>
          {/* 공고번호는 eaT로 건너가는 손잡이다. 마지막 한 걸음은 늘 "이 판을 eaT에서 연다"이다(EAT-248). */}
          {row.displayBidNo === null ? null : <span className='shrink-0 text-[13px]'><CopyBidNo value={row.displayBidNo} /></span>}
          {/* 제한지역은 공고지역과 다른 축이라 링크가 아니라 사실 표시다. 관측하지 못한 경우만 남긴다 — 제한
              없음으로 바꿔 적으면 낼 수 있는 공고가 목록에서 조용히 사라진다. 급한 일이 아니라 사실이라 색이
              아니라 굵기로 드러낸다. */}
          {row.eligibilityText === null ? <span className='shrink-0 font-semibold text-foreground'>제한지역 미관측</span> : null}
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
 * component다. 괘선은 행 사이 1px 안쪽 선 하나뿐이고 날짜가 바뀌는 자리는 묶음 머리의 선이 가른다.
 */
export function OpenAuctionCards({ groups, search }: { readonly groups: readonly ClosingSlotGroup[]; readonly search: TodaySearch }) {
  return (
    <div className='min-w-0'>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.titleText} className={group.past ? 'opacity-60' : undefined}>
          <SlotHead group={group} />
          <div className='mt-1.5'>
            {group.rows.map((row) => <AuctionRow key={row.auctionAttemptId} row={row} search={search} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
