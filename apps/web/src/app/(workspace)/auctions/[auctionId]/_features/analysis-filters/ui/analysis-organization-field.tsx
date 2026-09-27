/** @module 책임: 같은 그림에 겹쳐 찍을 기관을 그 지역 안에서 검색해 최대 여섯 곳 고르게 한다. */
'use client';
import { useState } from 'react';
import type { AnalysisFilterValue } from '@/api/analysis';
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

/** 계약이 정한 상한과 같은 수다. 색과 자리가 그 이상을 감당하지 못한다(PDR-0007). */
export const OVERLAY_LIMIT = 6;

/**
 * 겹쳐 찍을 기관을 고른다. **비교조건이 아니라 표시 축이다** — 고른다고 표본 수가 바뀌지 않고 같은
 * 그림에 점만 더해진다. 목록이 고른 비교 지역 안으로 좁혀지는 이유는, 전국 기관 수만 곳을 한 목록에
 * 세우면 찾는 일이 조건을 고르는 일보다 커지기 때문이다.
 */
export function AnalysisOrganizationField({
  filter,
  selected,
  changeOverlays
}: {
  readonly filter: AnalysisFilterValue | null;
  readonly selected: readonly string[];
  readonly changeOverlays: (next: readonly string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const { options } = useConditionOptions(filter, {
    sido: null,
    organizationQuery: search.trim() === '' ? null : search.trim()
  });
  /**
   * 보고 있는 기관 자신은 뺀다. 그 점은 이미 그림에 있으므로 겹쳐 찍어도 아무 일이 일어나지 않고,
   * 눌러도 변화가 없는 항목은 고장으로 읽힌다.
   */
  const organizations = (options?.organizations ?? []).filter(
    (option) => option.organizationId !== filter?.targetOrganizationId
  );
  const full = selected.length >= OVERLAY_LIMIT;
  return (
    <Combobox
      items={organizations.map((option) => option.organizationId)}
      multiple
      value={[...selected]}
      inputValue={search}
      onInputValueChange={setSearch}
      onValueChange={(next: readonly string[]) => {
        // 상한을 넘기는 선택은 받지 않는다. 넘긴 뒤 조용히 잘라 내면 무엇이 빠졌는지 알 수 없다.
        if (next.length <= OVERLAY_LIMIT) changeOverlays(next);
      }}
    >
      {/*
        화면의 주인공이 기관이라 라벨이 `기관`이면 "이 공고에 기관이 없다"로 읽힌다. 값도 `없음`이
        아니라 할 일을 적는다 — 아직 아무 일도 안 일어난 상태와 고를 것이 없는 상태는 다르다.
      */}
      <ComboboxTrigger
        className='w-36'
        aria-label={`비교 기관 ${selected.length === 0 ? '고르기' : `${selected.length}곳`}`}
      >
        <span className='text-xs whitespace-nowrap text-muted-foreground'>비교 기관</span>
        <ComboboxValue>
          {(value: readonly string[]) => (value.length === 0 ? '고르기' : `${value.length}곳`)}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent className='w-[26rem]'>
        <ComboboxInput placeholder='기관 이름으로 찾기' aria-label='기관 이름으로 찾기' className='mb-1 h-8 w-full' />
        <ComboboxEmpty>
          {search.trim() === ''
            ? '이 기관 말고는 이 조건에 개찰 기록이 있는 곳이 없어요'
            : '그런 이름의 기관이 이 조건에 없어요'}
        </ComboboxEmpty>
        <ComboboxList className='max-h-56 overflow-y-auto'>
          {(organizationId: string) => {
            const option = organizations.find((entry) => entry.organizationId === organizationId);
            const picked = selected.includes(organizationId);
            return (
              <ComboboxItem
                key={organizationId}
                value={organizationId}
                // 여섯을 채운 뒤에는 고른 것만 누를 수 있다. 누를 수 있는데 아무 일도 안 일어나면 고장으로 읽힌다.
                disabled={full && !picked}
                className='justify-between gap-3'
              >
                <span className='min-w-0 truncate'>
                  {option?.name ?? '기관명 미확인'}
                  {option?.region?.label ? (
                    <span className='ml-1.5 text-xs text-muted-foreground'>{option.region.label}</span>
                  ) : null}
                </span>
                <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                  {option === undefined ? '' : `${option.count.toLocaleString('ko-KR')}건`}
                </span>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
        <p className='mt-1 border-t border-border px-2 pt-1.5 text-xs text-muted-foreground'>
          {full
            ? `여섯 곳까지 겹쳐 볼 수 있어요. 바꾸려면 고른 기관을 먼저 빼 주세요.`
            : `최대 ${OVERLAY_LIMIT}곳까지 고를 수 있고 지금 ${selected.length}곳이에요. 겹쳐 찍어도 표본 수는 바뀌지 않아요.`}
          {options?.organizationsTruncated ? ' 목록이 길어 일부만 보여요. 이름을 더 적어 주세요.' : ''}
        </p>
      </ComboboxContent>
    </Combobox>
  );
}
