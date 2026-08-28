// 막는 사고: 학교 id 가 URL 을 오갈 때 인코딩이 한 번 더 걸리거나 덜 걸려 링크가 죽던 것.
// 실제로 /dashboard/schools/{id} 가 이중 인코딩(%25ED..)으로 "학교를 찾지 못했습니다"였다.
// 코드 기반 키로 갈아탈 때 이 창구 하나만 바꾸면 되도록 여기 모았다.
import { expect, test } from 'bun:test';
import { schoolIdFromParam, schoolIdToPath, parseSchoolId } from '../school-id';

// 픽스처: 라이브 /api/schools 실제 id
const ID = '화성시|기안초등학교';
const ENC = encodeURIComponent(ID); // %ED%99%94...%7C...

test('인코딩된 세그먼트를 원래 id 로 되돌린다', () => {
  expect(schoolIdFromParam(ENC)).toBe(ID);
});

test('이미 풀린 값은 건드리지 않는다', () => {
  expect(schoolIdFromParam(ID)).toBe(ID);
});

test('왕복해도 값이 유지된다 (이중 인코딩이 생기지 않는다)', () => {
  expect(schoolIdFromParam(schoolIdToPath(ID))).toBe(ID);
  expect(schoolIdToPath(schoolIdFromParam(ENC))).toBe(ENC);
});

test('% 가 든 이름에서 죽지 않는다', () => {
  expect(schoolIdFromParam('서울시|100%초등학교')).toBe('서울시|100%초등학교');
});

test('시군구와 학교명을 가른다', () => {
  expect(parseSchoolId(ID)).toEqual({ sigungu: '화성시', name: '기안초등학교' });
  expect(parseSchoolId('이름만')).toEqual({ sigungu: null, name: '이름만' });
});
