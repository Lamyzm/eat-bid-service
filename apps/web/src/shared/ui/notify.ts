/**
 * @module 책임: 토스트로 알리는 결과의 유일한 입구다. 토스트는 누른 자리가 이미 사라진 뒤에도 알려야 하는 결과(로그인 시작 실패·
 * 요청 실패)에만 쓰고, 복사됨·저장됨처럼 누른 자리에서 보이는 결과는 그 자리가 말한다(#240). `sonner`를 import하는 곳은 이
 * 파일과 토스트 틀(`sonner.tsx`) 둘뿐이며 architecture:check가 지킨다.
 */
import { toast } from 'sonner';

/** 같은 `id`는 한 장으로 겹쳐 쌓이지 않는다. */
export function notifyFailure(message: string, options?: { readonly id?: string }): void {
  toast.error(message, options?.id === undefined ? undefined : { id: options.id });
}
