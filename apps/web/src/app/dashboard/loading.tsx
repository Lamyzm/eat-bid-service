/** @module 책임: legacy dashboard segment의 최초 loading을 화면 전용 skeleton 경계에 연결한다. */
import { DashboardScreenSkeleton } from './_ui/dashboard-screen-skeleton';

export default function Loading() {
  return <DashboardScreenSkeleton />;
}
