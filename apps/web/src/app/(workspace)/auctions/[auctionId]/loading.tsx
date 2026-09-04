/** @module 책임: 공고 segment의 최초 server loading을 화면 전용 skeleton 경계에 연결한다. */
import { DecisionScreenSkeleton } from './_ui/decision-screen-skeleton';

export default function Loading() {
  return <DecisionScreenSkeleton />;
}
