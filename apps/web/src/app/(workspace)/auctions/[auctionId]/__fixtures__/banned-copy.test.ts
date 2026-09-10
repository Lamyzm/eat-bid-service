import { describe, expect, test } from 'bun:test';

import { findBannedCopy } from './banned-copy';

const rulesOf = (markup: string) => findBannedCopy(markup).map((match) => match.rule);

describe('금지 문구 검사', () => {
  test('분모 경고와 부정문처럼 행위를 유도하지 않는 문장은 통과한다', () => {
    // 첫 문장은 my-rate-input.tsx의 실제 경고다. 이 검사가 단어 수준으로 돌아가면 이 테스트가 먼저 깨진다(EAT-156).
    const markup = [
      '<span>이 눈금은 사정률입니다. NeaT에 넣는 투찰률과 분모가 다릅니다.</span>',
      '<span>추천하지 않습니다</span>',
      '<span>값을 넣으면 사다리에 줄이 그어집니다</span>',
      '<span>투찰률을 넣으면 지난 회차와 견줍니다</span>',
      '<span>이 값이면</span><span>낙찰값 이하였을 회차</span><span>지금 값을 그때 냈다면</span>',
      '<span>90.000 썼다면</span><span>낙찰값 위</span>'
    ].join('');
    expect(findBannedCopy(markup)).toEqual([]);
  });

  test('NeaT에 넣으라고 시키는 문장은 잡는다', () => {
    expect(rulesOf('<p>NeaT에 넣으세요</p>')).toEqual(['NeaT 입력 지시']);
    expect(rulesOf('<p>이 값을 NeaT에 그대로 입력하면 됩니다</p>')).toContain('NeaT 입력 지시');
    expect(rulesOf('<p>NeaT 입력값 92.285</p>')).toEqual(['NeaT 입력값 제시']);
  });

  test('특정 값으로 투찰하라는 문장은 잡는다', () => {
    expect(rulesOf('<p>이 값으로 투찰하세요</p>')).toEqual(['값 지목 지시']);
    expect(rulesOf('<p>이 값으로 넣으세요</p>')).toEqual(['값 지목 지시']);
    expect(rulesOf('<p>그 값을 내면 됩니다</p>')).toContain('값 지목 지시');
  });

  test('추천·안전 구간·탈락선·밀림 같은 판단 대행 어휘는 문장 속에서도 잡는다', () => {
    expect(rulesOf('<p>추천값</p>')).toEqual(['추천 어휘']);
    expect(rulesOf('<p>이 공고의 추천가는 90.030입니다</p>')).toEqual(['추천 어휘']);
    expect(rulesOf('<p>여기가 안전합니다</p>')).toEqual(['안전 단정', '자리 단정']);
    expect(rulesOf('<p>90.010 ~ 90.030은 안전 구간입니다</p>')).toEqual(['안전 단정']);
    expect(rulesOf('<p>탈락선 90.005</p>')).toEqual(['탈락 예측']);
    expect(rulesOf('<p>이 값이면 밀림</p>')).toEqual(['밀림 예측']);
  });

  test('자리 단정은 낙찰 확정형만 잡고 낙찰될 확률 같은 승률 문구는 통과한다', () => {
    expect(rulesOf('<p>이 값이면 낙찰됩니다</p>')).toEqual(['자리 단정']);
    expect(rulesOf('<p>이 값이면 낙찰될 것입니다</p>')).toEqual(['자리 단정']);
    // 예측 승률은 판단 재료로 경계 안에 있다(ADR 0027, ADR 0030).
    expect(rulesOf('<p>이 값이면 낙찰될 확률 30%</p>')).toEqual([]);
  });

  test('제목·칩에 홀로 선 추천·권장은 잡고 추천하지 않는다는 부정문은 통과한다', () => {
    expect(rulesOf('<h2>추천</h2>')).toEqual(['추천 어휘']);
    expect(rulesOf('<span class="chip">권장</span>')).toEqual(['추천 어휘']);
    expect(rulesOf('<p>추천하지 않습니다</p>')).toEqual([]);
  });

  test('강조 태그로 쪼개진 문장과 속성에 든 문구도 본다', () => {
    expect(rulesOf('<p><b>NeaT</b>에 넣으세요</p>')).toEqual(['NeaT 입력 지시']);
    expect(rulesOf('<input placeholder="추천값" value="">')).toEqual(['추천 어휘']);
  });

  test('실패 출력에는 규칙 이름·잡힌 문형·앞뒤 문맥이 함께 남는다', () => {
    const [match] = findBannedCopy('<p>기초금액을 보고 이 값으로 넣으세요. 마감은 내일입니다.</p>');
    expect(match).toEqual({
      rule: '값 지목 지시',
      phrase: '이 값으로 넣으세요',
      context: '기초금액을 보고 이 값으로 넣으세요. 마감은 내일입니다.'
    });
  });
});
