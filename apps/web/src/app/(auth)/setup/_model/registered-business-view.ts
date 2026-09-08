/** @module 책임: 등록 사업자 응답을 화면 문구로 옮기고 입력 사업자번호를 계약 command로 검증한다. */
import { registerMyBusinessCommandSchema, type RegisteredBusiness } from '@eatbid/contracts/api/v1/me';

/** 사람이 읽는 표기다. 저장·조회·관계는 canonical 숫자 열 자리를 그대로 쓴다. */
export function businessNumberDisplay(businessNumber: string): string {
  return `${businessNumber.slice(0, 3)}-${businessNumber.slice(3, 5)}-${businessNumber.slice(5)}`;
}

/**
 * "아직 원본에서 관측되지 않았다"를 "참여 기록이 없다"로 바꿔 말하지 않는다. 자료 없음과 미참여는 다른
 * 사실이고, 같은 번호를 원본이 나중에 관측하면 같은 등록이 저절로 연결된다(ADR 0032 §7).
 */
export function supplierStatusText(business: RegisteredBusiness): string {
  return business.supplier.kind === 'linked'
    ? '수집 원본에서 이 번호를 확인했습니다'
    : '수집 원본에 아직 이 번호가 없습니다';
}

export type BusinessNumberCheck =
  | { readonly ok: true; readonly businessNumber: string }
  | { readonly ok: false; readonly message: string };

/**
 * 입력 검증의 권위는 계약 command 하나다. 화면이 자체 정규식을 만들면 서버가 받는 값과 화면이 통과시킨
 * 값이 갈라진다. 이 검사는 오타를 거를 뿐 실재하는 사업자인지도, 그 주인이 사용자인지도 말하지 않는다.
 */
export function checkBusinessNumberInput(value: string): BusinessNumberCheck {
  const parsed = registerMyBusinessCommandSchema.safeParse({ businessNumber: value.trim() });
  if (parsed.success) return { ok: true, businessNumber: parsed.data.businessNumber };
  return { ok: false, message: '숫자 열 자리 사업자등록번호를 확인해 주세요.' };
}
