import { describe, expect, test } from "bun:test";
import {
  businessNumberInputSchema,
  businessNumberTextSchema,
  hasValidBusinessNumberCheckDigit,
  normalizeBusinessNumber,
} from "./business-number";

// 공개된 법인 사업자등록번호다. 우리 구현이 실제로 쓰이는 번호를 거부하지 않는다는 것을 증명한다.
const publishedBusinessNumbers = ["1248100998", "2208162517"];

describe("사업자등록번호 형식", () => {
  test("공개된 실제 번호를 거부하지 않는다", () => {
    for (const number of publishedBusinessNumbers) {
      expect(hasValidBusinessNumberCheckDigit(number)).toBe(true);
      expect(businessNumberTextSchema.parse(number)).toBe(number);
    }
  });

  test("하이픈과 공백이 섞인 사용자 입력을 canonical 숫자로 정규화한다", () => {
    expect(businessNumberInputSchema.parse(" 124-81-00998 ")).toBe("1248100998");
    expect(businessNumberInputSchema.parse("220 81 62517")).toBe("2208162517");
    expect(normalizeBusinessNumber("124–81–00998")).toBe("1248100998");
  });

  test("검증번호가 틀린 번호는 형식 실패이지 소유 실패가 아니다", () => {
    // 마지막 자리만 바꾼 값이라 길이와 자릿수는 맞지만 체크디짓에서 걸린다.
    expect(hasValidBusinessNumberCheckDigit("1248100997")).toBe(false);
    expect(businessNumberTextSchema.safeParse("1248100997").success).toBe(false);
  });

  test("자릿수·문자 형태가 틀린 입력을 거부한다", () => {
    for (const candidate of ["124810099", "12481009987", "12481O0998", ""]) {
      expect(businessNumberTextSchema.safeParse(candidate).success).toBe(false);
    }
    expect(businessNumberInputSchema.safeParse("124-81-0099").success).toBe(false);
  });
});
