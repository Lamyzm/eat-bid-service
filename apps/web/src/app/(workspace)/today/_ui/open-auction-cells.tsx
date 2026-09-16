/** @module 책임: 열린 공고 행의 셀 하나하나(기관·품목·기초금액·지난번·보통)가 저장된 값을 어떤 글자·링크·접힘으로 그리는지를 소유한다. 어떤 열이 있고 폭별로 어느 열이 접히는지는 open-auction-table이 정한다. */
import Link from 'next/link';

import { summarizeItemLabel } from '@/entities/item/item-label';

import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { OpenAuctionRowPresentation } from '../_model/present-open-auctions';

// 글자 크기는 둘뿐이다. 판단값은 전부 13px 한 크기이고 위계는 크기가 아니라 굵기와 색으로만 만든다 —
// 토스증권 목록이 열 칸을 13px/600 하나로 그리는 방식이다(2026-09-16 실측). 보조 줄은 12px 한 단 아래다.
export const MUTED = 'text-[12px] leading-tight font-medium text-muted-foreground';

export function OrganizationCell({
  row,
  search,
  rareRates
}: {
  readonly row: OpenAuctionRowPresentation;
  readonly search: TodaySearch;
  /** 좁은 폭에서 접힌 기초금액을 둘째 줄에 낼 때 드문 하한도 함께 적는다. */
  readonly rareRates: ReadonlySet<string>;
}) {
  const { organization, region, orgSummary } = row;
  // 지역 어휘 계약이 아직 없어 라벨을 관측하지 못한 지역이 있다. 그때 `코드 657`을 적으면 사용자가 읽을 수
  // 없는 글자가 기관 이름 옆을 차지한다. 라벨이 있는 것만 보인다(EAT-100까지).
  const places = [region.sido, region.sigungu].filter(
    (reference): reference is NonNullable<typeof reference> => reference !== null && !reference.text.startsWith('코드 ')
  );
  return (
    // xl(1280)에서는 이름과 보조 글자가 한 줄에 나란히 서고, 그 아래에서는 보조 글자가 둘째 줄로 내려온다.
    // 접힌 칸이 둘째 줄에 오는 폭에서만 행이 두 줄이 되고, 여덟 칸이 다 서는 폭에서는 44px 한 줄이다.
    // 나란히 설 자리가 모자라면 보조 글자가 줄을 바꾼다 — 기둥이 옆에 붙는 가장 좁은 2xl(1536)에서 기관 칸은
    // 184px이라 지역·제한지역 글자를 줄이지 않으면 이름이 4px로 눌려 사라진다(2026-09-16 e2e 실측). 보조 글자
    // 묶음도 줄어들 수 있어야 한다 — `shrink-0`이면 묶음 안의 낱말이 줄을 바꾸지 못하고 칸 밖으로 4px 샌다.
    <div className='grid min-w-0 gap-0.5 xl:flex xl:flex-wrap xl:items-baseline xl:gap-x-2 xl:gap-y-0.5'>
      {/* 행을 여는 자리는 기관 이름이다. 별도의 `열기` 열을 두면 모든 행에 같은 단어가 서른 번 서고,
          그 열의 너비만큼 기관 이름이 줄어든다. */}
      <Link
        href={row.href}
        className={`line-clamp-2 min-w-0 break-keep wrap-anywhere font-semibold hover:underline xl:line-clamp-1 ${organization.tone === 'named' ? '' : 'text-muted-foreground'}`}
      >
        {organization.text}
      </Link>
      <span className={`flex min-w-0 flex-wrap gap-x-2 empty:hidden ${MUTED}`}>
        {/* 지역 링크는 라벨이 아니라 code value id로 거른다. 라벨은 표시일 뿐이다(AGENTS 2·6). */}
        {places.map((reference) => (
          <Link key={reference.codeValueId} href={buildTodayFilterRoute(search, { sido: reference.codeValueId })} className='hover:underline'>
            {reference.text}
          </Link>
        ))}
        {/* 제한지역은 공고지역과 다른 축이라 링크가 아니라 사실 표시다. 관측한 제한은 위 조건 줄이 이미
            세고 있으므로 행에는 관측하지 못한 경우만 남긴다 — 제한 없음으로 바꿔 적으면 낼 수 있는
            공고가 목록에서 조용히 사라진다. */}
        {row.eligibilityText === null ? <span className='font-semibold text-foreground'>제한지역 미관측</span> : null}
        {/* 좁은 폭에서 접힌 칸을 둘째 줄에 둔다. 참여는 어느 폭에서나 제 열에 있다. md(768)에서 셸 탐색을
            빼면 표에 남는 폭이 398px뿐이라 여덟 칸을 다 세우면 기관 이름이 설 자리가 없다. 값을 지우는 것이
            아니라 줄을 옮기는 것이라 읽을 것은 그대로 남는다. 품목·기초금액은 lg부터, 지난번·보통은 2xl부터
            제 열에 선다. */}
        <span className='lg:hidden'>{row.itemLabel === null ? '품목 미확인' : summarizeItemLabel(row.itemLabel).text}</span>
        <span className='tabular-nums lg:hidden'>{row.baseAmountText}</span>
        {rareRates.has(row.floorRateText) ? <span className='tabular-nums lg:hidden'>하한 {row.floorRateText}</span> : null}
        {orgSummary === null ? null : (
          <>
            <span className='tabular-nums xl:hidden'>
              지난번 {orgSummary.lastRound.kind === 'observed' ? `${orgSummary.lastRound.listText} · ${orgSummary.lastRound.dateText}` : orgSummary.lastRound.text}
            </span>
            <span className='tabular-nums xl:hidden'>보통 {orgSummary.medianListText} · {orgSummary.listCountSampleCount}회</span>
          </>
        )}
      </span>
    </div>
  );
}

/**
 * 품목 칸이다. **링크가 거는 것은 라벨 전체가 아니라 조각 하나다.**
 *
 * 합성 라벨(`육류 , 가금류`)을 통째로 걸면 그 조합을 가진 행만 걸려 `육류`만 있는 행이 빠진다. 조각으로
 * 걸면 부분일치라 둘 다 걸린다. 접힌 `외 N`은 조각이 아니라 접었다는 표시라 링크가 아니다.
 */
export function ItemCell({ row, search }: { readonly row: OpenAuctionRowPresentation; readonly search: TodaySearch }) {
  if (row.itemLabel === null) return <span className='text-muted-foreground'>미확인</span>;
  const item = summarizeItemLabel(row.itemLabel);
  const head = item.parts[0]!;
  return (
    <span title={item.full ?? undefined} className='inline-flex items-baseline gap-1'>
      <Link href={buildTodayFilterRoute(search, { items: [head] })} className='hover:underline'>
        {head}
      </Link>
      {item.parts.length > 1 ? <span className={MUTED}>외 {item.parts.length - 1}</span> : null}
    </span>
  );
}

/**
 * 기초금액과, 이 목록에서 드문 하한일 때만 그 값이다.
 *
 * 하한을 열로 두지 않는 이유는 요약의 `floorSpread`가 소유한다. 여기서는 그 판정을 받아 적을 뿐이라
 * 드문 값이 하나도 없는 흔한 경우에는 옆 글자 자체가 없다.
 */
export function BaseAmountCell({ row, rareRates }: { readonly row: OpenAuctionRowPresentation; readonly rareRates: ReadonlySet<string> }) {
  return (
    <span className='inline-flex items-baseline justify-end gap-1.5 tabular-nums'>
      <span className='whitespace-nowrap'>{row.baseAmountText}</span>
      {rareRates.has(row.floorRateText) ? <span className={`${MUTED} whitespace-nowrap`}>하한 {row.floorRateText}</span> : null}
    </span>
  );
}

/**
 * 같은 하한 코호트의 직전 회차다. 명단 수와 개찰일, 그날 하한 아래 명단 수까지다.
 *
 * 낙찰 투찰률은 싣지 않는다. 같은 값이 행마다 서면 앵커링이다(decision-support §11). 보통(중앙값)과 따로
 * 두는 이유는 실측으로 직전 회차가 보통에서 30% 넘게 벗어나는 행이 절반이라 둘이 다른 말을 하기 때문이다.
 */
export function LastRoundCell({ row }: { readonly row: OpenAuctionRowPresentation }) {
  if (row.orgSummary === null) return <span className='text-muted-foreground'>—</span>;
  const last = row.orgSummary.lastRound;
  if (last.kind === 'none') return <span className={MUTED}>{last.text}</span>;
  return (
    <span className='whitespace-nowrap tabular-nums'>
      {last.listText}
      <span className={MUTED}>
        {' '}· {last.dateText}
        {last.belowText === null ? '' : ` · ${last.belowText}`}
      </span>
    </span>
  );
}

/**
 * 그 판의 보통이다. 표본 수를 함께 적는다 — 같은 `보통 68`이라도 다섯 회를 본 것과 열다섯 회를 본 것은
 * 무게가 다르고, 표본 없는 중앙값을 화면에 내면 그 차이가 사라진다(AGENTS 7). 중앙값은 percentile_disc라
 * 관측된 실제 한 값이지 대표 구간이 아니므로 표본이 얇아도 지우지 않는다(screen-system §8).
 */
export function MedianCell({ row }: { readonly row: OpenAuctionRowPresentation }) {
  if (row.orgSummary === null) return <span className='text-muted-foreground'>—</span>;
  const { medianListText, listCountSampleCount } = row.orgSummary;
  return (
    <span className='whitespace-nowrap tabular-nums'>
      {medianListText === '—' ? '—' : `${medianListText}곳`}
      <span className={MUTED}> · {listCountSampleCount}회</span>
    </span>
  );
}
