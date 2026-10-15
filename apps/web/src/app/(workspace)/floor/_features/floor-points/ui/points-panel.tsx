/** @module 책임: 공고별 보기(겹쳐 볼 층·칸 너비 고르기, 점 그림, 누른 공고 카드, 보이는 기간 요약)를 묶는다. */
'use client';
import { useQueryStates } from 'nuqs';
import { useMemo, useState, useTransition, type CSSProperties } from 'react';

import type { FloorPeriod } from '@/entities/floor-line/floor-period';
import { floorSearchParsers } from '@/app/(workspace)/floor/_lib/floor-search';
import type { BandWidth } from '@/app/(workspace)/floor/_lib/floor-stats';
import { countText } from '@/entities/floor-line/floor-units';
import type { FloorData } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';
import { bandRects, ladderDots, mineDots, windowSummary } from '../model/points-layers';
import { usePointsPalette } from '../model/use-points-palette';
import { FloorPointsChart } from './floor-points-chart';
import { PickedCard } from './picked-card';

/** 켜고 끄는 층이다. 시안처럼 켜짐·꺼짐을 글자로도 말한다 — 테두리 진하기만으로는 켠 것을 못 읽었다(2026-10-15 처음 보는 사장님 리뷰). */
const LAYER_CHIP =
  'inline-flex min-h-11 items-center gap-2 rounded-full border border-dashed border-border bg-background px-3.5 text-[14px] font-semibold text-muted-foreground aria-pressed:border-2 aria-pressed:border-solid aria-pressed:border-foreground aria-pressed:bg-muted aria-pressed:text-foreground';
/** 둘 중 하나를 고르는 칩이다. 기간 칩과 같은 채움으로 고른 것을 보인다. */
const CHOICE_CHIP =
  'inline-flex min-h-11 items-center rounded-full border border-border bg-background px-3.5 text-[14px] font-semibold text-muted-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background';

function OnOff({ on }: { readonly on: boolean }) {
  return <span className='text-[12px] font-semibold text-muted-foreground'>{on ? '켜짐' : '꺼짐'}</span>;
}

function Swatch({ style, className }: { readonly style?: CSSProperties; readonly className: string }) {
  return <i aria-hidden className={`inline-block shrink-0 ${className}`} style={style} />;
}

/** 고른 달의 첫날 0시부터 다음 달 첫날 직전까지다. 창 밖이면 확대하지 않는다. */
function focusZoom(period: FloorPeriod, month: string | null): readonly [number, number] | null {
  if (month === null) return null;
  const start = period.monthStarts[month];
  const next = Object.entries(period.monthStarts).find(([key]) => key > month)?.[1];
  return start === undefined || next === undefined ? null : [start, Math.min(next, period.end) - 1];
}

export function PointsPanel({
  data,
  period,
  width,
  onWidth,
  focusMonth
}: {
  readonly data: FloorData;
  readonly period: FloorPeriod;
  readonly width: BandWidth;
  readonly onWidth: (width: BandWidth) => void;
  /** 이 달로 확대해 연다. 복기 입구 줄과 그림 아래 "보이는 기간" 문장이 같은 숫자를 말하게 한다. */
  readonly focusMonth: string | null;
}) {
  const palette = usePointsPalette();
  const [pending, startTransition] = useTransition();
  const [{ ranks }, setSearch] = useQueryStates({ ranks: floorSearchParsers.ranks }, { shallow: false, history: 'replace', scroll: false, startTransition });
  const [band, setBand] = useState(true);
  const [mine, setMine] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const initialZoom = useMemo(() => focusZoom(period, focusMonth), [period, focusMonth]);
  const [range, setRange] = useState<readonly [number, number]>(initialZoom ?? [period.start, period.end]);
  const extent = useMemo(() => ({ start: period.start, end: period.end }), [period.start, period.end]);
  const layers = useMemo(
    () => ({
      bands: band ? bandRects(data.points, period, width) : [],
      ladders: ranks ? ladderDots(data.points, data.ladders) : [],
      mine: mine ? mineDots(data.points, data.mine) : { valid: [], below: [], won: [] }
    }),
    [band, mine, ranks, width, data, period]
  );
  const summary = useMemo(() => windowSummary(data.points, range, width), [data.points, range, width]);
  const mineAvailable = data.mine.kind !== 'not-operator';
  const mineNote =
    !mine || data.mine.kind === 'not-operator'
      ? null
      : data.mine.kind === 'read-failed'
        ? '내 업체 값을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.'
        : data.mine.bids.length === 0
          ? '고른 기간에 이 지역 공고에 내 업체가 넣은 값이 없어요.'
          : data.mine.unlinkedBusinessCount > 0
            ? `아직 eaT 기록에서 찾지 못한 사업자 ${data.mine.unlinkedBusinessCount}곳의 값은 빠져 있어요.`
            : null;
  const label = `${data.region.place} 공고 ${countText(data.points.length)}건의 하한선 점 그림. 가로는 개찰 날짜, 세로는 하한선(사정률과 기초금액 대비 %)`;
  return (
    <div className='grid gap-4'>
      <p className='max-w-[66ch] text-muted-foreground'>
        점 하나가 공고 하나의 하한선이에요. 가로는 개찰 날짜, 세로는 하한선이 기초금액의 몇 %에 나왔는지예요.
      </p>
      <div className='flex flex-wrap items-center gap-x-5 gap-y-2.5'>
        <div role='group' aria-label='겹쳐 볼 것' className='flex flex-wrap items-center gap-1.5'>
          <span className='mr-0.5 text-[13px] font-semibold text-muted-foreground'>겹쳐 보기</span>
          <button type='button' aria-pressed={band} onClick={() => setBand((current) => !current)} className={LAYER_CHIP}>
            <Swatch className='h-3 w-[22px] rounded-[3px] border-y-2 border-primary bg-primary/20' />
            달마다 가장 많이 나온 칸(지난 기록)
            <OnOff on={band} />
          </button>
          <button
            type='button'
            aria-pressed={ranks}
            aria-busy={pending}
            onClick={() => void setSearch({ ranks: !ranks })}
            className={LAYER_CHIP}
          >
            <Swatch className='size-3 rounded-full bg-muted-foreground/60' style={palette === null ? undefined : { background: palette.ladder }} />
            실제 투찰 1~10등
            {pending ? <span className='text-[12px] font-semibold text-muted-foreground'>불러오는 중</span> : <OnOff on={ranks} />}
          </button>
          {mineAvailable ? (
            <button type='button' aria-pressed={mine} onClick={() => setMine((current) => !current)} className={LAYER_CHIP}>
              <Swatch className='size-3 rounded-full bg-muted-foreground' style={palette === null ? undefined : { background: palette.mine }} />
              내 업체 값
              <OnOff on={mine} />
            </button>
          ) : null}
        </div>
        <div role='group' aria-label='몰린 칸 너비(기초금액 대비 %)' className='flex flex-wrap items-center gap-1.5'>
          <span className='mr-0.5 text-[13px] font-semibold text-muted-foreground'>몰린 칸 너비</span>
          {([0.1, 0.2] as const).map((option) => (
            <button key={option} type='button' aria-pressed={width === option} onClick={() => onWidth(option)} className={CHOICE_CHIP}>
              {option === 0.1 ? '좁게 · 기초금액의 0.1%' : '넓게 · 기초금액의 0.2%'}
            </button>
          ))}
        </div>
      </div>
      {mineNote === null ? null : <p className='text-[14px] text-muted-foreground'>{mineNote}</p>}
      <div className='flex flex-wrap gap-x-[18px] gap-y-1.5 text-[14px] text-muted-foreground'>
        {band ? (
          <span className='inline-flex items-center gap-1.5'>
            <Swatch className='h-3 w-[22px] rounded-[3px] border-y-2 border-primary bg-primary/20' />
            지나고 나서 본 그 달 가장 많이 나온 칸(다음 달 예상 아님)
          </span>
        ) : null}
        <span className='inline-flex items-center gap-1.5'>
          <Swatch className='size-3 rounded-full bg-primary' style={palette === null ? undefined : { background: palette.point }} />
          하한선(공고 하나)
        </span>
        {ranks ? (
          <span className='inline-flex items-center gap-1.5'>
            <Swatch className='size-3 rounded-full bg-muted-foreground/60' style={palette === null ? undefined : { background: palette.ladder }} />
            실제 투찰 1~10등(하한 위에서 낮게 낸 순)
          </span>
        ) : null}
        {mine && data.mine.kind === 'bids' ? (
          <>
            <span className='inline-flex items-center gap-1.5'>
              <Swatch className='size-3 rounded-full bg-muted-foreground' style={palette === null ? undefined : { background: palette.mine }} />
              내 업체 값
            </span>
            <span className='inline-flex items-center gap-1.5'>
              <Swatch className='size-3 rounded-full border-2 border-muted-foreground' style={palette === null ? undefined : { borderColor: palette.mine }} />
              내 업체 값이 하한 미달
            </span>
            <span className='inline-flex items-center gap-1.5'>
              <Swatch className='size-3.5 rounded-full border-[3px] border-muted-foreground' style={palette === null ? undefined : { borderColor: palette.mine }} />
              내 업체가 딴 값
            </span>
          </>
        ) : null}
      </div>
      <div className='rounded-2xl border border-border px-1 pt-2 pb-1'>
        <FloorPointsChart
          data={data}
          layers={layers}
          histogram={summary.histogram}
          range={extent}
          initialZoom={initialZoom}
          palette={palette}
          label={label}
          onRange={setRange}
          onPick={setPicked}
        />
      </div>
      {picked === null ? null : <PickedCard data={data} pointIndex={picked} ranksShown={ranks} />}
      <p className='text-[14px] text-muted-foreground'>
        마우스 휠이나 두 손가락으로 확대·축소하고 끌어서 옮겨요. 아래 막대 양 끝을 끌면 기간이, 왼쪽 세로 막대 양 끝을 끌면 % 범위가 좁혀져요.
        점을 누르면 그 공고가 그림 아래에 나와요.
      </p>
      <div aria-live='polite' className='grid gap-1 rounded-2xl bg-muted px-4 py-3.5'>
        <p className='text-[17px] font-bold tracking-[-0.02em] text-balance'>{summary.headline}</p>
        {summary.note === null ? null : <p className='text-muted-foreground'>{summary.note}</p>}
      </div>
    </div>
  );
}
