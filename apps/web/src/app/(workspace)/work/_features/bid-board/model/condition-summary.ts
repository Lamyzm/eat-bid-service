/**
 * @module 책임: 오늘 투찰 목록이 어떤 범위로 걸러졌는지(관심 지역·하한율·내 사업자 수)를 한 줄로 말한다. 범위의 권위는 서버에 저장된
 * 관심 지역과 등록 사업자이고, 여기서는 그 둘을 읽은 결과만 말한다 — 읽지 못한 조각은 지어내지 않고 뺀다.
 */
import type { MyRegionPreferenceV1Response } from '@eatbid/contracts/api/v1/me';

type Area = MyRegionPreferenceV1Response['preference']['areas'][number];

/** 이름이 길어 줄이 넘치지 않게 앞의 둘만 부르고 나머지는 수로 말한다. */
const NAMED_AREAS = 2;

/** 라벨이 관측되지 않은 코드는 지어낸 이름 대신 코드 문자열로 부른다(오늘 화면과 같은 규칙). */
const areaText = (area: Area) => area.label ?? `코드 ${area.code}`;

function regionPiece(areas: readonly Area[] | null): string | null {
  if (areas === null) return null;
  // 빈 목록은 "전국"이 아니다. 서버는 참가제한지역이 관측되지 않은 공고만 남긴다 — 오늘 화면과 같은 말을 쓴다.
  if (areas.length === 0) return '고른 지역 없음';
  const named = areas.slice(0, NAMED_AREAS).map(areaText).join(', ');
  const rest = areas.length - NAMED_AREAS;
  return `관심 지역 ${named}${rest > 0 ? ` 외 ${rest}곳` : ''}`;
}

export function conditionSummary(input: { readonly areas: readonly Area[] | null; readonly businessCount: number | null }): string {
  return [
    regionPiece(input.areas),
    // 오늘 투찰은 하한율 90%·88% 공고와 하한율을 아직 모르는 공고를 싣는다(서버 조회 조건과 같다).
    '하한율 90%·88%·미확인',
    input.businessCount === null ? null : `내 사업자 ${input.businessCount}곳`
  ].filter((piece) => piece !== null).join(' · ');
}
