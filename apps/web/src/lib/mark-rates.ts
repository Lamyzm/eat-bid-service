'use client';
/**
 * 회차 × 사업자 값 — 1단계(웹 전용) 무손실 계층
 *
 * 배경: `eatbid.marks` 와 서버 `user_mark` 이 회차당 값 1개(PK userId,bidNo)라
 * 두 사업자로 넣는 값의 절반이 저장될 자리가 없었다.
 *
 * 규칙
 * - 읽기는 순수 함수. 저장소를 건드리지 않는다.
 * - 레거시 `rate` 하나는 "첫 사업자 칸"에 귀속(등록 사업자가 없으면 미지정 칸 '').
 * - 쓰기는 `rates` 전용이다(3단계). 읽기는 구 형식 `rate` 도 계속 받는다 —
 *   서버가 아직 미러를 보내고, 다른 기기·예전 브라우저에 구 형식이 남아 있을 수 있다.
 * - 알 수 없는 필드는 그대로 보존해서 되돌려 준다(수동 편집·구버전 데이터 보호).
 * - 서버 계약이 `rates` 를 받기 전까지 둘째 사업자 값은 로컬에만 남는다(2단계에서 해소).
 */
import type { Mark } from '@/lib/session';

/** 사업자 미지정 슬롯 키 */
export const NO_BIZ = '';

/** 카드에 그릴 입력 슬롯 — 사업자가 없으면 미지정 한 칸 (지금과 동일한 화면) */
export function slotKeys(bizNos: string[]): string[] {
  return bizNos.length ? bizNos : [NO_BIZ];
}

/**
 * 이 회차에 그릴 슬롯 — 등록 사업자 + 값이 있는데 목록에 없는 키(서버의 biz_no='' 미지정 등).
 * 사업자를 등록하기 전에 저장한 값이 화면에서 사라지면 안 된다.
 */
export function slotKeysFor(mark: Mark | undefined, bizNos: string[]): string[] {
  const base = slotKeys(bizNos);
  const extra = Object.keys(ratesOf(mark, bizNos)).filter(k => !base.includes(k));
  return [...base, ...extra];
}

/** 회차의 사업자별 값 (순수 읽기 + 레거시 귀속) */
export function ratesOf(mark: Mark | undefined, bizNos: string[]): Record<string, number> {
  if (!mark || typeof mark !== 'object') return {};
  const out: Record<string, number> = {};
  const raw = (mark as any).rates;
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
  }
  // 레거시 단일 값 → 첫 사업자 칸 (규칙 A). rates 에 이미 값이 있으면 건드리지 않는다.
  if (Object.keys(out).length === 0 && typeof mark.rate === 'number' && Number.isFinite(mark.rate)) {
    out[slotKeys(bizNos)[0]] = mark.rate;
  }
  return out;
}

/** 한 슬롯의 값 */
export function rateOf(mark: Mark | undefined, bizNo: string, bizNos: string[]): number | undefined {
  return ratesOf(mark, bizNos)[bizNo];
}

/** 대표값 — 레거시 `rate` 미러와 기존 소비처(②·분석판)가 쓰는 값 */
export function primaryRate(mark: Mark | undefined, bizNos: string[]): number | undefined {
  const rates = ratesOf(mark, bizNos);
  for (const k of slotKeys(bizNos)) if (rates[k] != null) return rates[k];
  const first = Object.values(rates)[0];
  return typeof first === 'number' ? first : undefined;
}

/** 슬롯 하나를 바꾼 새 mark — 알 수 없는 필드는 보존. rate 미러는 쓰지 않는다(3단계) */
export function withRate(
  mark: Mark | undefined,
  bizNo: string,
  value: number | undefined,
  bizNos: string[],
  status?: Mark['s'],
): Mark | null {
  const rates = { ...ratesOf(mark, bizNos) };
  if (value == null) delete rates[bizNo];
  else rates[bizNo] = value;

  const s = status ?? mark?.s ?? 'watch';
  // 값이 전부 비고 관심 상태도 아니면 엔트리를 지운다 (기존 동작 유지)
  if (Object.keys(rates).length === 0 && s === 'watch' && !mark) return null;

  return stripMirror({ ...(mark ?? {}), s, rates } as Mark);
}

/** 저장 직전 정리 — 파생 필드 `rate` 는 저장소에 남기지 않는다 (읽기 호환은 훅에서 파생) */
export function stripMirror(mark: Mark): Mark {
  const { rate: _drop, ...rest } = mark as Mark & { rate?: number };
  return rest as Mark;
}

/** 카드에 채워진 값이 하나라도 있는지 */
export function hasAnyRate(mark: Mark | undefined, bizNos: string[]): boolean {
  return Object.keys(ratesOf(mark, bizNos)).length > 0;
}

/** 사업자 표기 — 상호가 있으면 상호, 없으면 뒤 4자리. 화면마다 다르게 쓰지 않는다 */
export function bizLabelOf(bizNo: string, names: Record<string, string>, forSlot = false): string {
  if (!bizNo) return forSlot ? '미지정' : '';
  return names[bizNo] ?? `…${bizNo.slice(-4)}`;
}

/** 두 값 집합이 같은지 — '이 값으로 갱신' 판별용 */
export function sameRates(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => a[k] === b[k]);
}
