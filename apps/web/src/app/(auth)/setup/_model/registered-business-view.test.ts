import { describe, expect, test } from 'bun:test';
import type { RegisteredBusiness } from '@eatbid/contracts/api/v1/me';

import {
  businessAccessibleName,
  businessNameText,
  businessNumberDisplay,
  checkBusinessNumberInput,
  supplierStatusText
} from './registered-business-view';

function business(supplier: RegisteredBusiness['supplier']): RegisteredBusiness {
  return {
    businessId: '7',
    businessNumber: '1248100998',
    registeredAt: '2026-09-09T00:00:00Z',
    supplier,
    location: null
  };
}

describe('등록 사업자 표시', () => {
  test('표기는 사람이 읽는 형태로 만들고 저장 값은 그대로 둔다', () => {
    expect(businessNumberDisplay('1248100998')).toBe('124-81-00998');
  });

  test('미관측을 미참여로 바꿔 말하지 않는다', () => {
    expect(supplierStatusText(business({ kind: 'evidence-conflict' }))).toBe(
      '수집 원본에서 이 번호가 두 업체를 가리켜 연결을 확정하지 못했습니다'
    );
    expect(supplierStatusText(business({ kind: 'unobserved' }))).toBe(
      '수집 원본에 아직 이 번호가 없습니다'
    );
    expect(supplierStatusText(business({ kind: 'linked', supplierPartyId: '9' }))).toBe(
      '수집 원본에서 이 번호를 확인했습니다'
    );
  });
});

describe('등록 사업자 업체명', () => {
  const linked = business({ kind: 'linked', supplierPartyId: '9' });

  test('원본 명단의 업체명을 번호 앞에 두고 읽기 이름에도 넣는다', () => {
    const named = { ...linked, supplierLabel: '(주)오뚜기축산' };
    expect(businessNameText(named)).toBe('(주)오뚜기축산');
    expect(businessAccessibleName(named)).toBe('등록 사업자 (주)오뚜기축산 124-81-00998');
  });

  test('이름이 관측되지 않았으면 미확인이라고 말하고, 옛 서버가 이름을 싣지 않았으면 아무것도 보이지 않는다', () => {
    expect(businessNameText({ ...linked, supplierLabel: null })).toBe('업체명 미확인');
    expect(businessNameText(linked)).toBeNull();
    expect(businessAccessibleName(linked)).toBe('등록 사업자 124-81-00998');
  });
});

describe('사업자번호 입력 검증', () => {
  test('하이픈 표기와 공백을 계약이 canonical 숫자로 정규화한다', () => {
    expect(checkBusinessNumberInput(' 124-81-00998 ')).toEqual({
      ok: true,
      businessNumber: '1248100998'
    });
  });

  test('검증번호가 맞지 않는 번호와 자릿수 오류를 거른다', () => {
    for (const value of ['124-81-00997', '12481009', '', 'abcdefghij']) {
      expect(checkBusinessNumberInput(value).ok).toBe(false);
    }
  });

  test('합성 검증 통과 번호는 그대로 canonical 값이 된다', () => {
    expect(checkBusinessNumberInput('9000000016')).toEqual({
      ok: true,
      businessNumber: '9000000016'
    });
    expect(checkBusinessNumberInput('9000000020')).toEqual({
      ok: true,
      businessNumber: '9000000020'
    });
  });
});
