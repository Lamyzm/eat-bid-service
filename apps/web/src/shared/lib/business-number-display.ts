/** @module 책임: 사업자등록번호의 사람이 읽는 표기 하나를 소유한다. 저장·조회·관계는 canonical 숫자 열 자리를 그대로 쓴다. */

export function businessNumberDisplay(businessNumber: string): string {
  return `${businessNumber.slice(0, 3)}-${businessNumber.slice(3, 5)}-${businessNumber.slice(5)}`;
}
