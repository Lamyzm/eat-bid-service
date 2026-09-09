/**
 * @module 책임: 사업자등록번호의 wire 형태와 오타를 거르는 형식 검증만 소유한다.
 *
 * 여기서 하는 일은 형식 검증이지 실재·소유 증명이 아니다. 체크디짓을 통과한 번호도 존재하지 않는
 * 사업자일 수 있고, 그 번호의 주인이 요청자라는 뜻은 더더욱 아니다. 그래서 이 schema를 통과한 값을
 * 화면·응답·로그 어디에서도 "확인된 사업자"로 부르지 않는다(ADR 0032 §7).
 */
import { z } from "zod";

const businessNumberLength = 10;
// 국세청 사업자등록번호 검증 가중치다. 아홉째 자리는 곱한 값의 십의 자리를 한 번 더 더한다.
const checkDigitWeights = Object.freeze([1, 3, 7, 1, 3, 7, 1, 3, 5]);

/** 하이픈·공백·유니코드 대시를 걷어낸 숫자만 남긴다. 길이·체크디짓 판정은 하지 않는다. */
export function normalizeBusinessNumber(value: string): string {
  return value.replace(/[\s‐-―-]/g, "");
}

export function hasValidBusinessNumberCheckDigit(digits: string): boolean {
  if (!/^[0-9]{10}$/.test(digits)) return false;
  const value = [...digits].map(Number);
  const weighted = checkDigitWeights.reduce(
    (total, weight, index) => total + weight * value[index]!,
    0,
  );
  const carried = weighted + Math.floor((value[8]! * 5) / 10);
  return (10 - (carried % 10)) % 10 === value[9];
}

/**
 * 저장·응답에 쓰는 canonical 형태다. 정체성이 아니라 대조 키이므로 FK나 URL 값으로 쓰지 않는다.
 * 정적 패턴이 wire 상한을 소유하고 체크디짓은 runtime check가 본다.
 */
export const businessNumberTextSchema = z.string()
  .length(businessNumberLength)
  .regex(/^[0-9]{10}$/)
  .refine(hasValidBusinessNumberCheckDigit, { error: "사업자등록번호 검증번호가 맞지 않습니다." })
  .meta({
    id: "BusinessNumberText",
    description: "Canonical ten-digit Korean business registration number text used only as a lookup key.",
    example: "1248100998",
  });

/**
 * 사용자가 화면에 적는 형태를 받아 canonical 숫자로 정규화한다.
 *
 * 입력 경계에서만 정규화하는 이유: 사람은 `123-45-67890`처럼 적고, 그 표기를 그대로 저장하면 같은
 * 사업자가 표기마다 다른 행이 된다. 정규화 결과가 wire로 나가므로 서버는 같은 schema로 다시 검증한다.
 */
export const businessNumberInputSchema = z.string()
  .min(businessNumberLength)
  .max(24)
  .transform(normalizeBusinessNumber)
  .pipe(businessNumberTextSchema);
