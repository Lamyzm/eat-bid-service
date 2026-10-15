/** @module 책임: 그림에서 누른 공고 하나의 하한선·기초금액·1~10등·내 업체 값을 글로 보인다. */
import { countText, manCheonText, organizationLabel, per100MillionText, rateText } from '@/app/(workspace)/floor/_lib/floor-units';
import type { FloorData, FloorMineBid } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';

function mineLine(bid: FloorMineBid, floor: number, baseAmount: number): string {
  const gap = manCheonText((baseAmount * (bid.rate - floor)) / 100);
  const head = `${bid.supplier} 사정률 ${rateText(bid.rate, 3)} · `;
  if (bid.outcome.kind === 'below-floor') return `${head}하한선보다 ${gap} 낮아 하한 미달`;
  if (bid.outcome.won) return `${head}이 값으로 낙찰`;
  return `${head}하한선보다 ${gap} 높게 냄 · 하한 위 ${bid.outcome.validBidderCount}곳 중 ${bid.outcome.rank}등`;
}

export function PickedCard({ data, pointIndex, ranksShown }: { readonly data: FloorData; readonly pointIndex: number; readonly ranksShown: boolean }) {
  const point = data.points[pointIndex];
  if (point === undefined) return null;
  const ladder = data.ladders?.find((entry) => entry.attemptId === point.attemptId) ?? null;
  const bids = data.mine.kind === 'bids' ? data.mine.bids.filter((bid) => bid.attemptId === point.attemptId) : [];
  const floorWon = Math.round((point.baseAmount * point.floor) / 100 / 1_000) * 1_000;
  const first = ladder?.lowest[0];
  const last = ladder?.lowest[ladder.lowest.length - 1];
  return (
    <section aria-label='고른 공고' className='grid gap-1 rounded-2xl border border-border px-4 py-3.5'>
      <h3 className='text-[16px] font-bold'>{organizationLabel(data.organizations, point.organization)}</h3>
      <p className='text-[14px] text-muted-foreground'>{point.opened}</p>
      <ul className='mt-1 grid list-disc gap-0.5 pl-[18px] text-[15px]'>
        <li>
          하한선 사정률 {rateText(point.floor, 3)} · 기초금액의 {point.floor.toFixed(2)}% · 1억이면 {per100MillionText(point.floor)}
        </li>
        <li>
          기초금액 {countText(point.baseAmount)}원 · 하한선 약 {countText(floorWon)}원
          {ladder === null ? '' : ` · 하한 위로 낸 곳 ${ladder.validBidderCount}곳`}
        </li>
        {first === undefined || last === undefined ? null : (
          <li>
            실제 1등 사정률 {rateText(first, 3)} · {ladder!.lowest.length}등까지 {rateText(first, 3)}~{rateText(last, 3)}
          </li>
        )}
        {ranksShown && ladder === null ? <li className='text-muted-foreground'>이 공고는 투찰 명단을 받지 못했어요.</li> : null}
        {bids.map((bid) => (
          <li key={`${bid.supplier}-${bid.rate}`}>{mineLine(bid, point.floor, point.baseAmount)}</li>
        ))}
        {data.mine.kind === 'bids' && bids.length === 0 ? <li className='text-muted-foreground'>내 업체가 넣지 않은 공고예요.</li> : null}
      </ul>
    </section>
  );
}
