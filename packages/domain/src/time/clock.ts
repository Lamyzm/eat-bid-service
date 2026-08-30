import { Temporal } from "./temporal.js";

export interface Clock {
  now(): Temporal.Instant;
}

/** 운영 시각 취득 지점을 한 곳으로 제한해 테스트와 업무 규칙이 ambient clock에 결합되지 않게 한다. */
export const systemClock: Clock = {
  now: () => Temporal.Now.instant(),
};

export const fixedClock = (instant: Temporal.Instant): Clock => ({
  now: () => instant,
});
