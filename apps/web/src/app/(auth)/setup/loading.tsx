/** @module 책임: 설정 route의 최초 진입 동안 실제 화면과 같은 골격만 보여 준다. */
import { SetupScreenSkeleton } from './_ui/setup-screen-skeleton';

export default function Loading() {
  return <SetupScreenSkeleton />;
}
