/** @module 책임: 표본 수를 화면 라벨로 옮기는 임계값을 한 자리에서 소유한다. */

/**
 * 임계값은 관측 사실이 아니라 제품 판단이다(`spec-cohort-v3.md` §2). 서버가 이 라벨을 실으면 모든
 * 미래 소비자가 그 판단을 물려받으므로 서버는 `sampleCount`만 주고 판단은 화면의 이 자리만 한다.
 *
 * 사다리·요약·각주·히트맵 달 행이 모두 이 함수를 쓴다. 임계값이 두 곳에 살면 같은 표본이 화면
 * 어디서는 "적음"이고 어디서는 아니게 된다.
 */
export type SampleSizeLabel = '표본 부족' | '표본 적음' | null;

const SCARCE_BELOW = 10;
const THIN_BELOW = 30;

export function sampleSizeLabel(sampleCount: number): SampleSizeLabel {
  if (sampleCount < SCARCE_BELOW) return '표본 부족';
  if (sampleCount < THIN_BELOW) return '표본 적음';
  return null;
}

/** 표본 수와 라벨을 한 문장으로. 라벨이 없으면 수만 말한다. */
export function sampleSizeText(sampleCount: number): string {
  const label = sampleSizeLabel(sampleCount);
  const count = `표본 ${sampleCount.toLocaleString('ko-KR')}회차`;
  return label === null ? count : `${count} · ${label}`;
}
