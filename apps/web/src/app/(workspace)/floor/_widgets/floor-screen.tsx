/** @module 책임: 하한선 자리의 화면 상태(지역 목록 실패·지역 고르기·점 실패·준비됨)마다 막대와 본문을 조립한다. */
import type { FloorScreenView } from '../_features/floor-board/model/present-floor';
import { FloorBoard } from '../_features/floor-board/ui/floor-board';
import { presentSummary } from '../_features/floor-summary/model/present-summary';
import { FloorSummary } from '../_features/floor-summary/ui/floor-summary';
import { RegionBar } from '../_features/region-picker/ui/region-bar';
import { FloorEvidence } from './floor-evidence';
import { FloorFrame } from './floor-frame';

const PICK_TEXT = {
  none: '어느 지역 공고를 볼까요? 시도와 시군구를 고르면 그 지역 하한선이 나와요.',
  'not-found': '주소의 지역을 찾지 못했어요. 시도와 시군구를 다시 골라 주세요.',
  empty: '고른 지역은 이 기간에 하한율 90% 공고가 없어요. 기간을 늘리거나 다른 지역을 골라 주세요.'
} as const;

function Notice({ children }: { readonly children: string }) {
  return <p className='max-w-[66ch] rounded-2xl bg-muted px-4 py-3.5 text-[16px] font-semibold'>{children}</p>;
}

export function FloorScreen({ view }: { readonly view: FloorScreenView }) {
  if (view.kind === 'regions-failed') {
    return (
      <FloorFrame bar={null}>
        <Notice>지역 목록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</Notice>
      </FloorFrame>
    );
  }
  const regionId = view.kind === 'ready' ? view.data.region.id : view.regionId;
  const sidoId = view.kind === 'ready' ? view.data.region.sidoId : view.kind === 'lines-failed' ? view.sidoId : null;
  // 다른 화면의 링크로 지역이 바뀌어도 막대 안 시도 고르기가 옛 값에 머물지 않게 지역마다 새로 만든다.
  const bar = <RegionBar key={regionId ?? 'none'} groups={view.groups} period={view.period.key} regionId={regionId} sidoId={sidoId} />;
  if (view.kind === 'pick') {
    return (
      <FloorFrame bar={bar}>
        <Notice>{PICK_TEXT[view.reason]}</Notice>
      </FloorFrame>
    );
  }
  if (view.kind === 'lines-failed') {
    return (
      <FloorFrame bar={bar}>
        <Notice>이 지역 하한선을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</Notice>
      </FloorFrame>
    );
  }
  return (
    <FloorFrame bar={bar}>
      {view.openedBy === 'my-bids' ? (
        <p className='-mt-2 text-[13px] text-muted-foreground'>내 업체가 최근 1년 가장 많이 넣은 지역이라 이 지역부터 보여 줘요. 다른 지역은 위에서 고르세요.</p>
      ) : null}
      <FloorSummary view={presentSummary(view.data, view.period)} />
      <FloorBoard data={view.data} period={view.period} focusMonth={view.focusMonth} />
      <FloorEvidence data={view.data} periodLabel={view.period.label} />
    </FloorFrame>
  );
}
