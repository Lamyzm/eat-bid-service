/** @module 책임: 비교 지역을 전국·시도·시군구의 2단 목록에서 하나 고르게 한다. */
'use client';
import { useState } from 'react';
import { CODE_SCHEME_NAMES } from '@eatbid/contracts/atoms/code-scheme-names';
import type { AnalysisFilterValue, AnalysisRegionCount } from '@/api/analysis';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue
} from '@/shared/ui/combobox';
import { useConditionOptions } from '../model/use-condition-options';

type Scope = AnalysisFilterValue['comparisonScope'];

/** 지역 이름이 없으면 코드값을 적지 않는다. 숫자는 사용자가 아는 말이 아니다(AGENTS 2·3). */
function regionName(region: { readonly label: string | null }): string {
  return region.label ?? '지역명 미확인';
}

function countText(count: number): string {
  return `${count.toLocaleString('ko-KR')}건`;
}

/**
 * 비교 지역 하나를 고른다. 전국과 시도는 왼쪽, 고른 시도 안의 시군구는 오른쪽에 선다 — 시군구를
 * 고르려면 먼저 시도를 정해야 하고, 그 순서가 보이지 않으면 전국 시군구 201개가 한 목록에 쏟아진다.
 *
 * 건수는 **지역 축만 푼 집합**에서 세므로 "이 지역으로 바꾸면 몇 건이 되나"를 말한다. 0건인 지역이
 * 목록에 아예 없는 이유도 같다 — 고르면 빈 그림이 될 자리를 고르게 두지 않는다.
 */
export function AnalysisRegionField({
  filter,
  scope,
  changeComparison
}: {
  readonly filter: AnalysisFilterValue | null;
  readonly scope: Scope;
  readonly changeComparison: (next: Scope) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  /**
   * 어느 시도를 펼쳐 둘지는 고른 지역이 정한다. 시군구를 골랐으면 그 부모 시도이며, 그 부모는 첫 응답이
   * 알려 준다. 그래서 조회가 두 번 돈다 — 처음에는 시도 목록만, 그다음에 그 시도의 시군구까지.
   * 펼칠 시도를 모른 채 시군구를 묻지 않는 이유는, 안 물은 것과 없는 것이 같은 빈 목록이 되기 때문이다.
   */
  const first = useConditionOptions(filter, { sido: expanded, organizationQuery: null });
  const selected = first.options?.selectedRegion ?? null;
  const shownSido = expanded
    ?? selected?.parentSidoCodeValueId
    ?? (selected?.region.scheme === CODE_SCHEME_NAMES.auctionLocationSido ? selected.region.codeValueId : null);
  const { options } = useConditionOptions(filter, { sido: shownSido, organizationQuery: null });
  const sigungu = options?.sigunguCounts ?? [];
  const sidoName = options?.sidoCounts.find((entry) => entry.region.codeValueId === shownSido);
  const label = scope.kind === 'national'
    ? '전국'
    : selected === null ? '지역 선택' : regionName(selected.region);

  const choose = (next: Scope) => {
    changeComparison(next);
    setOpen(false);
  };
  return (
    <Combobox
      items={sigungu.map((entry) => entry.region.codeValueId)}
      open={open}
      onOpenChange={setOpen}
      value={scope.kind === 'region' ? scope.codeValueId : null}
      onValueChange={(value: string | null) => {
        const picked = sigungu.find((entry) => entry.region.codeValueId === value);
        // 사전이 준 체계를 그대로 싣는다. 시도와 시군구는 서로 다른 어휘라 화면이 골라 주면 안 된다(AGENTS 6).
        if (picked && value !== null) {
          choose({ kind: 'region', scheme: CODE_SCHEME_NAMES.auctionLocationSigungu, codeValueId: value });
        }
      }}
    >
      {/*
        좁은 폭에서는 `지역` 라벨을 눈에서만 감춘다. 값 자체가 지역 이름이라 무엇을 고른 것인지
        말하며, 이름(`비교 지역 …`)은 그대로 남아 화면 낭독기는 비교 대상임을 읽는다.
      */}
      <ComboboxTrigger className='w-36 max-xl:w-28' aria-label={`비교 지역 ${label}`}>
        <span className='analysis-optional-label text-xs whitespace-nowrap text-muted-foreground'>
          지역
        </span>
        <ComboboxValue>{() => label}</ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent className='w-[30rem] p-0'>
        {/* 같은 숫자가 다른 체계에서 다른 구역을 가리킨다. 어느 어휘인지를 목록이 먼저 말한다(AGENTS 6). */}
        <p className='border-b border-border px-3 py-2 text-xs text-muted-foreground'>
          eaT 공고지역이에요. 행정구역·참가제한지역과 다른 코드예요.
        </p>
        <div className='flex'>
          <div className='max-h-72 w-40 shrink-0 overflow-y-auto border-r border-border p-1'>
            {/*
              전국에도 건수를 찍는다. 다른 줄에만 숫자가 있으면 가장 큰 후보가 "아직 못 센 값"으로
              읽힌다. 합계는 사전 전체의 시도 건수에 지역을 관측하지 못한 회차를 더한 값이다 —
              지역 축을 안 건 같은 집합이라야 "전국으로 바꾸면 몇 건"이 된다.
            */}
            <RegionRow
              name='전국'
              count={
                options === null
                  ? undefined
                  : options.sidoCounts.reduce((sum, entry) => sum + entry.count, 0) +
                    options.regionUnobservedCount
              }
              selected={scope.kind === 'national'}
              onSelect={() => choose({ kind: 'national' })}
            />
            {(options?.sidoCounts ?? []).map((entry) => (
              <RegionRow
                key={entry.region.codeValueId}
                name={regionName(entry.region)}
                count={entry.count}
                selected={entry.region.codeValueId === shownSido}
                onSelect={() => setExpanded(entry.region.codeValueId)}
              />
            ))}
          </div>
          <div className='min-w-0 flex-1 p-1'>
            {shownSido === null ? (
              <p className='px-2 py-6 text-center text-xs text-muted-foreground'>
                왼쪽에서 시도를 먼저 고르면 그 안의 시군구가 보여요.
              </p>
            ) : (
              <>
                <RegionRow
                  name={`${sidoName ? regionName(sidoName.region) : '이 시도'} 전체`}
                  count={sidoName?.count}
                  selected={scope.kind === 'region' && scope.codeValueId === shownSido}
                  onSelect={() => choose({
                    kind: 'region',
                    scheme: CODE_SCHEME_NAMES.auctionLocationSido,
                    codeValueId: shownSido
                  })}
                />
                <ComboboxInput placeholder='시군구 찾기' aria-label='시군구 찾기' className='my-1 h-8 w-full' />
                <ComboboxEmpty>그런 시군구가 없어요</ComboboxEmpty>
                <ComboboxList className='max-h-56 overflow-y-auto'>
                  {(codeValueId: string) => {
                    const entry = sigungu.find((value) => value.region.codeValueId === codeValueId);
                    return (
                      <ComboboxItem
                        key={codeValueId}
                        value={codeValueId}
                        className={`justify-between${entry?.count === 0 ? ' text-muted-foreground' : ''}`}
                      >
                        <span>{entry ? regionName(entry.region) : '지역명 미확인'}</span>
                        {entry ? (
                          <span
                            className={`text-xs tabular-nums${entry.count === 0 ? ' text-muted-foreground/60' : ' text-muted-foreground'}`}
                          >
                            {countText(entry.count)}
                          </span>
                        ) : null}
                      </ComboboxItem>
                    );
                  }}
                </ComboboxList>
              </>
            )}
          </div>
        </div>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * 왼쪽 목록의 한 줄이다. 고른 자리를 색만으로 말하지 않고 `aria-current`로도 남긴다.
 *
 * 0건인 지역도 지우지 않고 흐리게 남긴다. 목록에서 빼면 사용자는 그 지역이 애초에 없는 것인지 지금
 * 조건 때문에 빠진 것인지 알 수 없고, "여기는 이 조건으로 0건이니 조건을 풀어야겠다"는 판단의 재료가
 * 사라진다(시안 h-conditions의 회색 0건).
 */
function RegionRow({
  name,
  count,
  selected,
  onSelect
}: {
  readonly name: string;
  readonly count?: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const empty = count === 0;
  return (
    <button
      type='button'
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent aria-current:bg-primary/10 aria-current:text-primary${empty ? ' text-muted-foreground' : ''}`}
    >
      <span className='truncate'>{name}</span>
      {count === undefined ? null : (
        <span className={`shrink-0 text-xs tabular-nums${empty ? ' text-muted-foreground/60' : ' text-muted-foreground'}`}>
          {countText(count)}
        </span>
      )}
    </button>
  );
}

export type { AnalysisRegionCount };
