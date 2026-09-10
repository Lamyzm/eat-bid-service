/** @module 책임: 사이드바 계정 슬롯 한 줄의 아이콘·제목·보조 문구 배치를 소유해 메뉴와 대기 자리가 같은 모양을 쓰게 한다. */
import {
  IconAlertTriangle,
  IconSelector,
  IconUserCircle
} from '@/shared/ui/workspace-icons';

interface AccountSlotFaceProps {
  readonly title: string;
  readonly detail: string;
  /** 로그인 자체가 불가능한 배포에서만 켠다. 조회 실패와 달리 사용자가 지금 할 수 있는 일이 없다. */
  readonly alert?: boolean;
}

export function AccountSlotFace({ title, detail, alert = false }: AccountSlotFaceProps) {
  return (
    <>
      {alert ? (
        <IconAlertTriangle className='size-5 shrink-0' />
      ) : (
        <IconUserCircle className='size-5 shrink-0' />
      )}
      <span className='grid min-w-0 flex-1 text-left leading-tight'>
        <span className='truncate text-sm font-medium'>{title}</span>
        <span className='truncate text-xs text-muted-foreground'>{detail}</span>
      </span>
      <IconSelector className='ml-auto size-4' />
    </>
  );
}
