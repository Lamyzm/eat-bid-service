'use client';
/** 로그인 버튼 — GOOGLE_CLIENT_ID 미설정이면 숨김. 로그인 강제 없음(게스트 그대로 사용 가능) */
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { signInGoogle, signOut } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

export function AuthButton({ compact = false }: { compact?: boolean }) {
  const { ready, guest, user, googleEnabled } = useSession();
  const [ask, setAsk] = useState(false);
  if (!ready || !googleEnabled) return null;
  if (guest) {
    return (
      <Button size='sm' variant='outline' onClick={() => void signInGoogle()}>
        Google로 로그인
      </Button>
    );
  }
  return (
    <div className='flex items-center gap-2 text-xs'>
      {!compact && <span className='text-muted-foreground max-w-[140px] truncate'>{user?.email ?? user?.name}</span>}
      <Button size='sm' variant='ghost' onClick={() => setAsk(true)}>로그아웃</Button>
      {ask && (
        <div className='bg-card absolute top-12 right-4 z-50 w-72 rounded-md border p-3 shadow-md'>
          <div className='text-sm font-medium'>로그아웃할까요?</div>
          <p className='text-muted-foreground mt-1 text-xs'>
            이 브라우저에 남은 기록(사업자·지역·투찰 저장)도 지울 수 있습니다. 공용 PC라면 삭제를 권합니다.
          </p>
          <div className='mt-2 flex flex-wrap gap-1.5'>
            <Button size='sm' onClick={() => void signOut(false)}>로그아웃 (기록 유지)</Button>
            <Button size='sm' variant='destructive' onClick={() => void signOut(true)}>기록도 삭제</Button>
            <Button size='sm' variant='ghost' onClick={() => setAsk(false)}>취소</Button>
          </div>
        </div>
      )}
    </div>
  );
}
