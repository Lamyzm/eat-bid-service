import { describe, expect, test } from 'bun:test';

import {
  ALL_VERDICT_PHRASES,
  FORBIDDEN_VERDICT_WORDS,
  REHEARSAL_PHRASE,
  ROW_VERDICT_PHRASE,
  SOURCE_VERDICT_PHRASE
} from './verdict-vocabulary';

describe('판정 어휘(PDR-0002)', () => {
  test('어떤 문구에도 원본 판정 코드에 없는 판정어가 들어가지 않는다', () => {
    for (const phrase of ALL_VERDICT_PHRASES) {
      for (const word of FORBIDDEN_VERDICT_WORDS) {
        expect(phrase.text).not.toContain(word);
        expect(phrase.sub ?? '').not.toContain(word);
      }
    }
  });

  test('원본 라벨은 BID_STT 002 낙찰·005 낙찰실패 둘뿐이다', () => {
    expect(Object.keys(SOURCE_VERDICT_PHRASE)).toEqual(['002', '005']);
    expect(SOURCE_VERDICT_PHRASE['002']).toEqual({ text: '낙찰', basis: { kind: 'source', scheme: 'BID_STT', code: '002' } });
    expect(SOURCE_VERDICT_PHRASE['005']).toEqual({ text: '낙찰실패', basis: { kind: 'source', scheme: 'BID_STT', code: '005' } });
  });

  test('회차별·집계 문구는 전부 파생이며 원본 라벨을 그대로 되풀이하지 않는다', () => {
    const sourceTexts = Object.values(SOURCE_VERDICT_PHRASE).map((phrase) => phrase.text);
    for (const phrase of [...Object.values(ROW_VERDICT_PHRASE), ...Object.values(REHEARSAL_PHRASE)]) {
      expect(phrase.basis.kind).toBe('derived');
      expect(sourceTexts).not.toContain(phrase.text);
    }
  });

  test('그날 하한과 견준 문구는 하한이 관측이 아니라 계산값이라는 근거를 단다', () => {
    expect(ROW_VERDICT_PHRASE.invalid.basis).toEqual({ kind: 'derived', comparedWith: 'day-floor' });
    expect(REHEARSAL_PHRASE.belowDayFloor.basis).toEqual({ kind: 'derived', comparedWith: 'day-floor' });
    expect(REHEARSAL_PHRASE.belowDayFloor.sub).toContain('계산');
  });
});
