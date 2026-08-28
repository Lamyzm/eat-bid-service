'use client';
/** 로그인 버튼 — GOOGLE_CLIENT_ID 미설정이면 숨김. 로그인 강제 없음(게스트 그대로 사용 가능) */
import { useSession } from '@/lib/session';
import { signInGoogle, signOut } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

export function AuthButton({ compact = false }: { compact?: boolean }) {
  const { ready, guest, user, googleEnabled } = useSession();
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
      <Button size='sm' variant='ghost' onClick={() => void signOut()}>로그아웃</Button>
    </div>
  );
}
