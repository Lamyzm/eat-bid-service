/** @module 책임: 등록 사업자 하나를 내 사업자에서 빼는 두 단계 확인(누르기 → 뺄까요?)과 그 pending·실패 문구를 소유한다. */
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import {
  accountQueries,
  revokeMyBusiness,
  type PrivateWorkspaceScope,
  type RegisteredBusiness
} from '@/api/account';
import { Button } from '@/shared/ui/button';
import { LoadingButton } from '@/shared/ui/loading-button';

import { businessNumberDisplay } from '../_model/registered-business-view';

interface BusinessRevokeButtonProps {
  readonly business: RegisteredBusiness;
  readonly scope: PrivateWorkspaceScope;
  readonly canWrite: boolean;
}

/**
 * 한 번 눌러 바로 빼지 않는다. 뺀 사업자는 맞춤 금액 계산에서도 빠지므로, 무엇이 빠지는지 이름으로 말하고 한 번 더 묻는다.
 * 브라우저 확인 창 대신 같은 자리에서 묻는다 — 폰에서도 같은 모양이고 읽기 도구가 흐름을 따라간다.
 */
export function BusinessRevokeButton({ business, scope, canWrite }: BusinessRevokeButtonProps) {
  const client = useQueryClient();
  const messageId = useId();
  const [confirming, setConfirming] = useState(false);
  const revoke = useMutation({
    mutationFn: () => revokeMyBusiness({ businessId: business.businessId }),
    onSuccess: () => client.invalidateQueries({ queryKey: accountQueries.businesses(scope).queryKey })
  });

  if (!canWrite) return null;
  // 이름이 관측되지 않았으면 "업체명 미확인을 뺄까요"가 되므로 번호로 말한다.
  const label = business.supplierLabel ?? businessNumberDisplay(business.businessNumber);

  if (!confirming) {
    return (
      <Button type='button' variant='ghost' size='sm' className='ml-auto' onClick={() => setConfirming(true)}>
        목록에서 빼기
      </Button>
    );
  }
  return (
    <div role='group' aria-describedby={messageId} className='grid w-full gap-2 rounded-md bg-muted/60 p-2.5 text-sm'>
      <p id={messageId}>
        {label}을(를) 내 사업자에서 뺄까요? 맞춤 금액 계산에서도 빠져요. 같은 번호는 나중에 다시 등록할 수 있어요.
      </p>
      <div className='flex flex-wrap gap-2'>
        <LoadingButton type='button' variant='destructive' size='sm' loading={revoke.isPending} loadingLabel='빼는 중…' onClick={() => revoke.mutate()}>
          빼기
        </LoadingButton>
        <Button type='button' variant='outline' size='sm' disabled={revoke.isPending} onClick={() => setConfirming(false)}>
          취소
        </Button>
      </div>
      {revoke.isError ? (
        <p role='alert' className='text-destructive'>
          빼지 못했어요. 잠시 뒤 다시 시도해 주세요.
        </p>
      ) : null}
    </div>
  );
}
