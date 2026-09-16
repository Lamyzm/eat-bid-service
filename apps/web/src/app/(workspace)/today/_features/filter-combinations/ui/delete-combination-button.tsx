/** @module 책임: 저장된 프리셋 하나를 지우는 command의 pending과 실패를 소유한다. */
'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { deleteFilterCombination } from '@/api/account';

/**
 * 확인 창을 두지 않는다. 조합은 조건 한 벌의 이름표일 뿐이라 지워도 잃는 것이 없고, 같은 조건을 다시
 * 걸어 다시 저장하면 된다. 되돌릴 수 없는 것에만 확인을 둔다.
 *
 * 이름을 접근 가능한 이름에 넣는다. 조합이 다섯이면 `지우기` 다섯이 같은 이름으로 서서 어느 것을
 * 지우는지 말하지 않는다.
 */
export function DeleteCombinationButton({
  filterCombinationId,
  name
}: {
  readonly filterCombinationId: string;
  readonly name: string;
}) {
  const router = useRouter();
  const remove = useMutation({
    mutationFn: () => deleteFilterCombination({ filterCombinationId }),
    // 기둥은 서버가 그린 목록이라 route를 다시 읽어야 남은 조합과 건수가 함께 온다.
    onSuccess: () => router.refresh()
  });
  return (
    <button
      type='button'
      disabled={remove.isPending}
      onClick={() => remove.mutate()}
      className='ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-0 hover:bg-foreground/5 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40'
    >
      <span aria-hidden>×</span>
      <span className='sr-only'>{name} 프리셋 지우기</span>
    </button>
  );
}
