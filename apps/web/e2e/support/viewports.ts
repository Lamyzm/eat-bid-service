/**
 * @module 책임: 브라우저 스위트가 쓰는 viewport 폭을 한 곳에 두고, 폭 경계는 제품 코드의 breakpoints 모듈에서
 * 읽어 e2e가 CSS·JS와 다른 숫자를 검사하지 않게 한다. 경계가 아닌 폭(시안 캔버스·휴대폰·넓은 데스크톱)은
 * 여기만 안다(EAT-154).
 */
import { BREAKPOINT_PX } from '../../src/shared/lib/breakpoints';

export const VIEWPORT_WIDTH = {
  /** 시안 캔버스 폭. 경계가 아니라 xl 계층을 시안과 대조하는 폭이며 xl과 달라지는 동작이 없다. */
  designCanvas: 1440,
  /** 오늘 화면의 조건 기둥이 본문 옆에 붙는 가장 좁은 폭. 기둥과 여덟 칸 표가 같이 서야 하는 자리다. */
  xxl: BREAKPOINT_PX['2xl'],
  /** 넓은 데스크톱 모니터. */
  wideDesktop: 1920,
  /** 휴대폰 폭. sm 미만 배치를 본다. */
  phone: 375,
  xl: BREAKPOINT_PX.xl,
  lg: BREAKPOINT_PX.lg,
  md: BREAKPOINT_PX.md,
  sm: BREAKPOINT_PX.sm
} as const;
