/** @module 책임: 비교하는 모든 집단에 같게 걸리는 품목 조건을 여러 개 고르는 여닫이 한 칸으로 세운다. */
'use client';
import { AUCTION_ITEM_ATOMS } from '@eatbid/contracts/api/v1/auctions';
import type { AnalysisConditionOptionsV1Response } from '@/api/analysis';
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
import { itemSelectionText } from '../lib/condition-text';
import type { AnalysisDraft } from '../model/analysis-filter-types';

/** 목록에서 `품목 미확인`이 갖는 값이다. 원자 여덟과 한 목록에 서되 어휘에는 들어가지 않는다. */
export const ITEM_UNKNOWN_VALUE = '품목 미확인';
const ITEM_CHOICES = [...AUCTION_ITEM_ATOMS, ITEM_UNKNOWN_VALUE] as const;

/**
 * 품목은 여럿을 고르고 `품목 미확인`도 값이다. 아무것도 고르지 않은 상태가 전체이며 그 사실을
 * 여닫이와 목록 아래 문구가 함께 말한다 — 빈 칸이 "아무것도 안 나온다"로 읽히면 조건을 잘못 이해한다.
 *
 * 공고가 품목을 말하지 않은 회차가 3분의 1이라(PDR-0007) 그 값을 목록에 함께 세우되, 아홉째 품목으로
 * 읽히지 않게 선으로 가른다.
 */
export function AnalysisItemField({
  draft,
  changeItems,
  options
}: {
  readonly draft: AnalysisDraft;
  readonly changeItems: (selection: readonly string[]) => void;
  readonly options: AnalysisConditionOptionsV1Response | null;
}) {
  const countOf = (item: string) =>
    item === ITEM_UNKNOWN_VALUE
      ? options?.itemUnknownCount
      : options?.itemCounts.find((entry) => entry.item === item)?.count;
  const selected = draft.itemUnknown ? [...draft.items, ITEM_UNKNOWN_VALUE] : [...draft.items];
  return (
    <Combobox items={ITEM_CHOICES} multiple value={selected} onValueChange={changeItems}>
      {/*
        라벨이 `품목`만이면 "이 기관의 품목"으로 읽힌다. 이 조건은 대상·비교군·겹쳐 찍은 기관 **모두**에
        같게 걸리며(PDR-0007) 그 사실은 조건 막대가 sticky인 동안에도 따라와야 한다. 본문 문장은 스크롤
        하면 사라지므로 라벨이 직접 말한다.

        이름도 직접 준다. 여닫이 안의 글자는 Base UI가 `aria-hidden`으로 덮어 이름이 비고, 이름 없는
        조작은 화면 낭독기에서 무엇을 여는지 말하지 않는다. 보이는 글자와 같은 문장을 쓴다.
      */}
      <ComboboxTrigger className='w-32' aria-label={`공통 품목 ${itemSelectionText(selected)}`}>
        <span className='text-xs whitespace-nowrap text-muted-foreground'>공통 품목</span>
        <ComboboxValue>{(value: readonly string[]) => itemSelectionText(value)}</ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput placeholder='품목 찾기' aria-label='품목 찾기' className='mb-1 h-8 w-full' />
        <ComboboxEmpty>그런 품목이 없어요</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem
              key={item}
              value={item}
              className={`justify-between gap-3${item === ITEM_UNKNOWN_VALUE ? ' mt-1 border-t border-border pt-2' : ''}`}
            >
              <span>{item}</span>
              <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                {countOf(item) === undefined ? '' : `${countOf(item)!.toLocaleString('ko-KR')}건`}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
        <p className='mt-1 border-t border-border px-2 pt-1.5 text-xs text-muted-foreground'>
          {selected.length === 0
            ? '아무것도 안 고르면 전체 품목이에요.'
            : `지금 ${selected.length}개를 골랐어요. 여러 개를 고를 수 있어요.`}{' '}
          품목 미확인은 공고가 품목을 말하지 않은 회차예요.
        </p>
      </ComboboxContent>
    </Combobox>
  );
}
