/** @module 책임: 지금 조건에 이름을 붙여 저장하는 한 command의 이름 입력·pending·실패 문구를 소유한다. */
'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { saveFilterCombination } from '@/api/account';
import type { TodaySearch } from '@/app/(workspace)/today/_lib/today-search-params';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { LoadingButton } from '@/shared/ui/loading-button';

/**
 * 상한 초과와 이름 중복을 나눠 말한다. 둘 다 409지만 사용자가 할 일이 다르다 — 앞은 하나 지워야 하고
 * 뒤는 다른 이름을 적으면 된다. 한 문장으로 합치면 어느 쪽인지 몰라 둘 다 시도하게 된다.
 */
function failureText(error: unknown): string {
  const code = (error as { readonly problem?: { readonly code?: string } } | null)?.problem?.code;
  if (code === 'LIMIT_REACHED') return '저장한 조합이 다섯입니다. 하나를 지우고 다시 저장해 주세요.';
  if (code === 'NAME_TAKEN') return '같은 이름의 조합이 이미 있습니다.';
  return '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
}

/**
 * `＋ 이 조건 저장`은 **쉬는 상태에서도 자리를 지킨다.** 나타났다 사라지면 사용자가 자리를 못 외우고,
 * 늘 진하면 누를 것이 없을 때도 눌러 본다. 저장할 것이 생기는 순간에만 눈에 든다.
 */
export function SaveCombinationForm({
  search,
  canSave,
  full
}: {
  readonly search: TodaySearch;
  /** 지금 조건이 조건 없음이거나 이미 저장된 조합과 같으면 저장할 것이 없다. */
  readonly canSave: boolean;
  readonly full: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const messageId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const save = useMutation({
    mutationFn: (combinationName: string) => saveFilterCombination({
      name: combinationName,
      sido: search.sido ?? undefined,
      items: search.items ?? undefined,
      baseAmountMin: search.baseAmountMin ?? undefined,
      baseAmountMax: search.baseAmountMax ?? undefined
    }),
    onSuccess: () => {
      setName('');
      setOpen(false);
      // 기둥은 서버가 그린 목록이라 캐시 무효화가 아니라 route를 다시 읽어야 새 조합과 건수가 함께 온다.
      router.refresh();
    }
  });

  if (!open) {
    return (
      <button
        type='button'
        disabled={!canSave || full}
        onClick={() => setOpen(true)}
        className='rounded-lg px-2.5 py-1.5 text-left text-[15px] font-medium text-muted-foreground hover:bg-foreground/5 disabled:pointer-events-none disabled:text-muted-foreground/40'
      >
        ＋ 이 조건 저장
      </button>
    );
  }
  return (
    <form
      className='grid gap-1.5 px-2.5 py-1.5'
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed !== '') save.mutate(trimmed);
      }}
    >
      <Label htmlFor={inputId} className='text-[13px] font-medium text-muted-foreground'>조합 이름</Label>
      <Input
        id={inputId}
        value={name}
        maxLength={40}
        autoFocus
        aria-describedby={save.isError ? messageId : undefined}
        onChange={(event) => setName(event.target.value)}
        placeholder='김해 축산'
      />
      <div className='flex gap-1.5'>
        <LoadingButton type='submit' loading={save.isPending} disabled={name.trim() === ''} className='h-8 flex-1'>
          저장
        </LoadingButton>
        <button
          type='button'
          onClick={() => { setOpen(false); setName(''); save.reset(); }}
          className='h-8 rounded-lg px-3 text-[13px] font-semibold hover:bg-foreground/5'
        >
          취소
        </button>
      </div>
      {save.isError ? <p id={messageId} className='text-[13px] font-medium text-destructive'>{failureText(save.error)}</p> : null}
    </form>
  );
}
