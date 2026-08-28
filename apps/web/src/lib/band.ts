/**
 * "잘 나온 구간"의 근거 고르기 — 품목별 값이 있으면 그걸 쓴다.
 *
 * 서버가 `byCat[품목]`을 이미 보내는데(응답의 19.9%) 웹이 한 번도 읽지 않아,
 * 축산 사장이 김치·농산이 섞인 전 품목 합산 구간을 보고 있었다.
 *
 * 그리고 어느 근거로 고른 구간인지 화면이 밝히지 않아, 같은 학교의 "잘 나온 구간"이
 * 학교 찾기·공고 상세·분석판에서 서로 다른 하한을 근거로 나왔다(D-12).
 * 그래서 값과 함께 `basis`(품목·하한·표본 수)를 돌려준다.
 */

export type Dense = { lo: number; hi: number; pct: number; n?: number; of?: number };
export type Band = { n?: number; dense?: Dense } | null | undefined;

export type BandSource = {
  category?: string | null;
  categories?: string[] | null;
  floorRate?: number | null;
  band?: Band;
  recent3?: number[];
  nSameFloor?: number | null;
  byCat?: Record<string, { band?: Band; recent3?: number[]; nSameFloor?: number }> | null;
};

export type PickedBand = {
  band: Band;
  recent3: number[];
  /** 표본 수 */
  n: number;
  /** 품목 근거 — 단일 품목이면 그 품목, 아니면 null(전 품목 합산) */
  category: string | null;
  floorRate: number | null;
};

/** 이 공고의 품목들 */
export function categoriesOf(o: BandSource): string[] {
  if (o.categories?.length) return o.categories;
  return o.category ? [o.category] : [];
}

export function pickBand(o: BandSource): PickedBand {
  const cats = categoriesOf(o);
  const only = cats.length === 1 ? cats[0] : null;
  const per = only ? o.byCat?.[only] : undefined;

  if (per?.band) {
    return {
      band: per.band,
      recent3: per.recent3 ?? [],
      n: per.nSameFloor ?? per.band.n ?? 0,
      category: only,
      floorRate: o.floorRate ?? null,
    };
  }
  return {
    band: o.band,
    recent3: o.recent3 ?? [],
    n: o.nSameFloor ?? o.band?.n ?? 0,
    category: null,
    floorRate: o.floorRate ?? null,
  };
}

/** 근거 한 줄 — "축산 · 하한 90 · 5회 중 20%" / 품목을 못 가르면 그 사실을 밝힌다 */
export function bandBasisText(p: PickedBand): string {
  const parts: string[] = [];
  parts.push(p.category ?? '전 품목 합산');
  if (p.floorRate != null) parts.push(`하한 ${p.floorRate}`);
  if (p.band?.dense && p.n > 0) parts.push(`${p.n}회 중 ${p.band.dense.pct}%`);
  else if (p.n > 0) parts.push(`${p.n}회`);
  return parts.join(' · ');
}
