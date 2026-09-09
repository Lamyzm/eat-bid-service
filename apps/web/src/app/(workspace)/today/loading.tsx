/** @module 책임: 오늘 segment의 최초 server loading을 화면 전용 skeleton 경계에 연결한다. */
import { TodayScreenSkeleton } from './_ui/today-screen-skeleton';

export default function Loading() {
  return <TodayScreenSkeleton />;
}
