// 막는 사고: 읽지 못한 저장소를 조용히 빈 값으로 덮어써 사용자 데이터를 지운 것.
// 경쟁사 목록(eatbid.rivals)이 catch{} 뒤 토글 한 번에 [] 로 날아갔다.
import { expect, test } from 'bun:test';
import { readStored, jsonCodec, flagCodec, choiceCodec, type KV } from '../use-persisted-state';

function fakeKV(init: Record<string, string> = {}): KV & { dump: () => Record<string, string> } {
  const m = { ...init };
  return {
    getItem: (k: string) => (k in m ? m[k] : null),
    setItem: (k: string, v: string) => { m[k] = v; },
    dump: () => ({ ...m }),
  };
}

// 픽스처: 브라우저 실측으로 손상시켜 재현한 실제 저장값
const BROKEN = '[{"bizNo":"123",,BROKEN';

test('읽지 못하면 원본을 덮지 않고 사본을 남긴다', () => {
  const kv = fakeKV({ 'eatbid.rivals': BROKEN });
  const r = readStored('eatbid.rivals', jsonCodec(v => Array.isArray(v)), kv);
  expect(r.value).toBeUndefined();
  expect(r.unreadable).toBe(true);
  expect(kv.dump()['eatbid.rivals']).toBe(BROKEN);            // 원본 그대로
  expect(kv.dump()['eatbid.rivals.unreadable']).toBe(BROKEN); // 사본 보존
});

test('사본은 한 번만 남긴다 (나중 값으로 덮지 않는다)', () => {
  const kv = fakeKV({ 'eatbid.rivals': BROKEN, 'eatbid.rivals.unreadable': '먼저있던사본' });
  readStored('eatbid.rivals', jsonCodec(), kv);
  expect(kv.dump()['eatbid.rivals.unreadable']).toBe('먼저있던사본');
});

test('형태가 다르면 손상으로 본다', () => {
  const kv = fakeKV({ k: '{"a":1}' });
  expect(readStored('k', jsonCodec(v => Array.isArray(v)), kv).unreadable).toBe(true);
});

test('저장 형식을 바꾸지 않는다', () => {
  const kv = fakeKV({ f: '1', c: 'flow' });
  expect(readStored('f', flagCodec, kv).value).toBe(true);
  expect(readStored('c', choiceCodec(['flow', 'record'] as const), kv).value).toBe('flow');
  // 허용 목록 밖은 무시하되 손상으로 보지 않는다 (렌즈 이름이 바뀌었을 수 있다)
  const gone = readStored('c', choiceCodec(['record'] as const), kv);
  expect(gone.value).toBeUndefined();
  expect(gone.unreadable).toBe(false);
});
