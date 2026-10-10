/**
 * @module 책임: 계약이 주는 정확한 십진 문자열들을 Number를 거치지 않고 더해 천 단위로 끊은 표시 문자열로 바꾼다.
 *
 * 표시용 합계라도 Number로 더하면 95.0이 95.00000000000001이 된다. 같은 자릿수의 정수로 바꿔 더하면 비교·정렬도 정확하다.
 * web 빌드 대상이 ES2020 미만이라 BigInt 리터럴 대신 생성자로 만든다.
 */
const GROUPING = /\B(?=(\d{3})+(?!\d))/g;

/** 값들 가운데 가장 긴 소수 자릿수다. 서로 다른 자릿수의 값을 같은 단위로 더하려고 쓴다. */
export function decimalScale(values: readonly string[]): number {
  return Math.max(0, ...values.map((value) => (value.split('.')[1] ?? '').length));
}

/** 값들을 `scale` 자릿수의 정수 단위로 바꿔 더한다. */
export function sumAtScale(values: readonly string[], scale: number): bigint {
  return values.reduce((sum, value) => {
    const [whole, fraction = ''] = value.split('.');
    return sum + BigInt(whole + fraction.padEnd(scale, '0'));
  }, BigInt(0));
}

/** `scale` 자릿수 정수 단위를 천 단위 쉼표가 붙은 십진 문자열로 되돌린다. */
export function scaledText(units: bigint, scale: number): string {
  const digits = units.toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale).replace(GROUPING, ',');
  return scale === 0 ? whole : `${whole}.${digits.slice(-scale)}`;
}
