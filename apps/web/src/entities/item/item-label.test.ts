import { describe, expect, test } from 'bun:test';

import { summarizeItemLabel } from './item-label';

// 운영 화면에서 관측된 원천 라벨 모양 그대로다(쉼표 앞뒤 공백 포함).
const MULTI_ITEM_LABEL = '농산물 , 수산물 , 육류 , 가공식품 , 김치류 , 곡류 , 가금류';

describe('품목 라벨 축약', () => {
  test('품목이 하나면 라벨을 그대로 두고 전체 목록을 남기지 않는다', () => {
    expect(summarizeItemLabel('축산')).toEqual({ text: '축산', full: null, parts: ['축산'] });
  });

  test('품목이 여러 개면 첫 품목 외 나머지 개수로 접고 전체 목록을 다듬어 남긴다', () => {
    expect(summarizeItemLabel(MULTI_ITEM_LABEL)).toEqual({
      text: '농산물 외 6',
      full: '농산물, 수산물, 육류, 가공식품, 김치류, 곡류, 가금류',
      // 조각은 필터 값이다. 합성 라벨을 통째로 걸면 그 조합을 가진 행만 걸린다.
      parts: ['농산물', '수산물', '육류', '가공식품', '김치류', '곡류', '가금류']
    });
  });

  test('빈 조각(연속 쉼표·끝 쉼표)은 품목으로 세지 않는다', () => {
    expect(summarizeItemLabel('농산물,,수산물,')).toEqual({ text: '농산물 외 1', full: '농산물, 수산물', parts: ['농산물', '수산물'] });
  });
});
