'use client';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { boot, retrySync, useSession } from '@/lib/session';
import { signInGoogle } from '@/lib/auth-client';

/**
 * 앱 부팅 시 /api/me 1회 조회 (게스트도 200) + 서버 동기화 실패 고지
 *
 * 저장 실패를 조용히 넘기지 않는다. 로컬에는 이미 저장돼 있으므로
 * "값을 잃었다"가 아니라 "서버에 못 올렸다"로 정확히 말한다.
 */
export function SessionBoot() {
  const { syncError, guest } = useSession();
  const shown = useRef(false);

  useEffect(() => { void boot(); }, []);

  useEffect(() => {
    if (!syncError || guest) { shown.current = false; return; }
    if (shown.current) return;
    shown.current = true;

    const body = syncError.unauthorized
      ? '로그인이 풀렸습니다. 이 브라우저에는 저장됐고, 다시 로그인하면 서버에 올라갑니다.'
      : '이 브라우저에는 저장됐습니다. 서버 동기화에 실패해 다른 기기에서는 보이지 않습니다.';

    toast.error(body, {
      duration: Infinity,
      action: syncError.unauthorized
        ? { label: '다시 로그인', onClick: () => void signInGoogle() }
        : {
            label: '다시 시도',
            onClick: () => {
              shown.current = false;
              void retrySync().then(ok => {
                if (ok) toast.success('서버에 저장됐습니다.');
              });
            },
          },
    });
  }, [syncError, guest]);

  return null;
}
