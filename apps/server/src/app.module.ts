import { Module, Controller, Get, Query, Param } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { eq, ilike, and, desc, inArray, sql, gte } from "drizzle-orm";
import {
  SchoolsQuery, OpenQuery, schools, schoolAuctions, openAuctions, marketRegions, firmBids, firms, schoolRoster,
} from "@eatbid/shared";
import { db } from "./db";

/** zod 계약 → DTO. 검증은 전역 ZodValidationPipe가 수행 */
class SchoolsQueryDto extends createZodDto(SchoolsQuery) {}
class OpenQueryDto extends createZodDto(OpenQuery) {}

@Controller("schools")
class SchoolsController {
  @Get()
  async list(@Query() q: SchoolsQueryDto) {
    const conds = [];
    if (q.sigungu) conds.push(eq(schools.sigungu, q.sigungu));
    if (q.category) conds.push(eq(schools.category, q.category));
    if (q.q) conds.push(ilike(schools.name, `%${q.q}%`));
    return db.select().from(schools)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schools.nAuctions))
      .limit(q.limit).offset(q.offset);
  }

  @Get("forecast")
  async forecast(@Query("sigungu") sigungu?: string) {
    const rows = await db.select({
      schoolId: schoolAuctions.schoolId, openedAt: schoolAuctions.openedAt, winRate: schoolAuctions.winRate,
    }).from(schoolAuctions).orderBy(schoolAuctions.schoolId, schoolAuctions.openedAt);
    const bySchool = new Map<string, string[]>();
    const lastWin = new Map<string, number>();
    const sggSet = sigungu ? new Set(sigungu.split(",").map(x => x.trim()).filter(Boolean)) : null;
    for (const r of rows) {
      if (sggSet && !sggSet.has(r.schoolId.split("|")[0])) continue;
      const l = bySchool.get(r.schoolId) ?? [];
      l.push(r.openedAt); bySchool.set(r.schoolId, l);
      if (r.winRate != null) lastWin.set(r.schoolId, r.winRate);
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out: any[] = [];
    for (const [schoolId, dates] of bySchool) {
      if (dates.length < 4) continue;
      const recent = dates.slice(-7);
      const gaps = recent.slice(1).map((d, i) =>
        Math.round((+new Date(d) - +new Date(recent[i])) / 864e5))
        .filter(g => g > 5 && g < 90).sort((a, b) => a - b);
      if (!gaps.length) continue;
      const medGap = gaps[Math.floor(gaps.length / 2)];
      const last = dates[dates.length - 1];
      const expected = new Date(+new Date(last) + medGap * 864e5);
      const dueInDays = Math.round((+expected - +today) / 864e5);
      if (dueInDays < -5 || dueInDays > 14) continue;
      out.push({ schoolId, schoolName: schoolId.split("|")[1], lastOpened: last,
        medGapDays: medGap, expected: expected.toISOString().slice(0, 10), dueInDays,
        lastWinRate: lastWin.get(schoolId) ?? null });
    }
    return out.sort((a, b) => a.dueInDays - b.dueInDays);
  }

  @Get(":id/auctions")
  async auctions(@Param("id") id: string) {
    const rows = await db.select().from(schoolAuctions)
      .where(eq(schoolAuctions.schoolId, id))
      .orderBy(schoolAuctions.openedAt);
    const bz = [...new Set(rows.map(r => r.winnerBizNo).filter((x): x is string => !!x))];
    const names = bz.length
      ? await db.select({ bizNo: firms.bizNo, name: firms.name }).from(firms).where(inArray(firms.bizNo, bz))
      : [];
    const nm = new Map(names.map(f => [f.bizNo, f.name]));
    return rows.map(r => ({ ...r, winnerName: r.winnerBizNo ? (nm.get(r.winnerBizNo) ?? null) : null }));
  }

  /** 단골 참여 업체 — 사실 전부. 해석 라벨 없음 */
  @Get(":id/roster")
  async roster(@Param("id") id: string) {
    const rows = await db.select().from(schoolRoster)
      .where(eq(schoolRoster.schoolId, id))
      .orderBy(desc(schoolRoster.partN)).limit(30);
    // 사실 문장 재료: 이 학교 연속 낙찰 최대 횟수
    const aucs = await db.select({ w: schoolAuctions.winnerBizNo })
      .from(schoolAuctions).where(eq(schoolAuctions.schoolId, id))
      .orderBy(schoolAuctions.openedAt);
    let maxStreak = 0, cur = 0; let prev: string | null = null;
    for (const a of aucs) {
      cur = a.w && a.w === prev ? cur + 1 : 1;
      prev = a.w; if (cur > maxStreak) maxStreak = cur;
    }
    return { rows, maxStreak };
  }

  /** 이 학교에서 내(워크스페이스) 투찰 이력 */
  @Get(":id/my-bids")
  async myBids(@Param("id") id: string, @Query("bizNos") bizNosCsv: string) {
    const bizNos = (bizNosCsv ?? "").split(",").map(x => x.trim().replace(/-/g, "")).filter(Boolean);
    if (!bizNos.length) return [];
    const name = id.split("|")[1] ?? id;
    return db.select({
      openedAt: firmBids.openedAt, floorRate: firmBids.floorRate, basePrice: firmBids.basePrice,
      bidRate: firmBids.bidRate, winRate: firmBids.winRate, won: firmBids.won,
    }).from(firmBids)
      .where(and(inArray(firmBids.bizNo, bizNos), eq(firmBids.schoolName, name)))
      .orderBy(firmBids.openedAt);
  }
}

@Controller("open")
class OpenController {
  /** 공고에 학교 재료를 붙인다: 같은 하한 밴드·최근 낙찰 3개·보통 업체 수 */
  private async enrich(r: typeof openAuctions.$inferSelect) {
    const schoolId = r.sigungu && r.schoolName ? `${r.sigungu}|${r.schoolName}` : null;
    let band: unknown = null, recent3: number[] = [], usualN: number | null = null, nSameFloor = 0;
    if (schoolId) {
      const [sc] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
      if (sc && r.floorRate != null) {
        const bf = sc.byFloor as Record<string, any>;
        band = bf[String(r.floorRate)] ?? bf[r.floorRate.toFixed(1)] ?? null;
      }
      const aucs = await db.select().from(schoolAuctions)
        .where(eq(schoolAuctions.schoolId, schoolId))
        .orderBy(schoolAuctions.openedAt);
      const same = aucs.filter(a => r.floorRate == null || a.floorRate === r.floorRate);
      nSameFloor = same.length;
      recent3 = same.slice(-3).map(a => a.winRate).filter((x): x is number => x != null);
      const last10 = aucs.slice(-10).map(a => a.nValid).sort((a, b) => a - b);
      usualN = last10.length ? last10[Math.floor(last10.length / 2)] : null;
    }
    return {
      ...r, schoolId,
      anchorAmount: r.basePrice && r.floorRate ? Math.round(r.basePrice * r.floorRate / 100) : null,
      band, recent3, usualN, nSameFloor,
    };
  }

  @Get()
  async list(@Query() q: OpenQueryDto) {
    const rows = await db.select().from(openAuctions);
    const filtered = rows
      .filter(r => !q.region || (r.sigungu ?? "").includes(q.region)
        || (r.allowedRegions ?? []).some(a => a.includes(q.region!)))
      .filter(r => !q.category || r.category === q.category);
    return Promise.all(filtered.map(r => this.enrich(r)));
  }

  @Get(":bidNo")
  async one(@Param("bidNo") bidNo: string) {
    const [r] = await db.select().from(openAuctions).where(eq(openAuctions.bidNo, bidNo)).limit(1);
    if (!r) return null;
    return this.enrich(r);
  }
}

@Controller("results")
class ResultsController {
  /** 투찰 표시한 공고들의 개찰 결과 조회 */
  @Get()
  async results(@Query("bidNos") bidNosCsv: string, @Query("bizNos") bizNosCsv: string) {
    const bidNos = (bidNosCsv ?? "").split(",").map(x => x.trim()).filter(Boolean);
    const bizNos = (bizNosCsv ?? "").split(",").map(x => x.trim().replace(/-/g, "")).filter(Boolean);
    if (!bidNos.length) return [];
    const aucs = await db.select().from(schoolAuctions).where(inArray(schoolAuctions.bidId, bidNos));
    const mine = bizNos.length
      ? await db.select().from(firmBids)
          .where(and(inArray(firmBids.bidId, bidNos), inArray(firmBids.bizNo, bizNos)))
      : [];
    return bidNos.map(bidNo => {
      const a = aucs.find(x => x.bidId === bidNo);
      const m = mine.filter(x => x.bidId === bidNo)
        .sort((x, y) => (y.won - x.won) || ((y.bidRate ?? 0) - (x.bidRate ?? 0)))[0];
      if (!a) return { bidNo, schoolName: null, openedAt: null, winRate: null, myRate: null, status: "대기" as const, diff: null };
      const base = { bidNo, schoolName: a.schoolId.split("|")[1] ?? null, openedAt: a.openedAt, winRate: a.winRate, myRate: m?.bidRate ?? null };
      if (!m) return { ...base, status: "기록없음" as const, diff: null };
      if (m.won) return { ...base, status: "낙찰" as const, diff: 0 };
      const below = m.bidRate != null && a.floorRate != null && m.bidRate < a.floorRate;
      const diff = m.bidRate != null && a.winRate != null ? +(m.bidRate - a.winRate).toFixed(3) : null;
      return { ...base, status: below ? ("하한미달" as const) : ("밀림" as const), diff };
    });
  }
}

@Controller("wins")
class WinsController {
  /** 적재된 지역 목록 (데이터 유도 — 거짓 '전국' 방지) */
  @Get("regions")
  async regions() {
    const rows = await db.select({
      sgg: sql<string>`split_part(school_id, '|', 1)`,
      n: sql<number>`count(*)`,
    }).from(schoolAuctions).groupBy(sql`split_part(school_id, '|', 1)`)
      .orderBy(desc(sql`count(*)`));
    return rows.filter(r => r.sgg && r.sgg.trim()).map(r => ({ sigungu: r.sgg, n: Number(r.n) }));
  }

  /** 개찰 속보 — 최근 개찰 결과 전량 (낙찰 업체명·1-2등차 포함) */
  @Get("recent")
  async recent(@Query("days") daysStr?: string, @Query("category") category?: string,
    @Query("sigungu") sigungu?: string) {
    const days = Math.min(Number(daysStr) || 30, 180);
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const conds = [gte(schoolAuctions.openedAt, cutoff)];
    if (category) conds.push(eq(schoolAuctions.category, category));
    if (sigungu) {
      const sggs = sigungu.split(",").map(x => x.trim()).filter(Boolean);
      if (sggs.length === 1) conds.push(ilike(schoolAuctions.schoolId, `${sggs[0]}|%`));
      else if (sggs.length > 1) conds.push(inArray(sql`split_part(school_id, '|', 1)`, sggs));
    }
    const rows = await db.select().from(schoolAuctions)
      .where(and(...conds)).orderBy(desc(schoolAuctions.openedAt)).limit(400);
    const ids = rows.map(r => r.bidId);
    const agg = ids.length ? await db.select({
      bidId: firmBids.bidId,
      nBids: sql<number>`count(*)`,
      secondRate: sql<number | null>`min(bid_rate) filter (where win_rate is not null and bid_rate > win_rate)`,
    }).from(firmBids).where(inArray(firmBids.bidId, ids)).groupBy(firmBids.bidId) : [];
    const byId = new Map(agg.map(a => [a.bidId, a]));
    const bizs = [...new Set(rows.map(r => r.winnerBizNo).filter(Boolean))] as string[];
    const names = bizs.length ? await db.select({ bizNo: firms.bizNo, name: firms.name })
      .from(firms).where(inArray(firms.bizNo, bizs)) : [];
    const nm = new Map(names.map(n => [n.bizNo, n.name]));
    return rows.map(r => {
      const g = byId.get(r.bidId);
      return {
        bidId: r.bidId, schoolId: r.schoolId, schoolName: r.schoolId.split("|")[1] ?? r.schoolId,
        sigungu: r.schoolId.split("|")[0] ?? null, category: r.category, openedAt: r.openedAt,
        basePrice: r.basePrice, floorRate: r.floorRate, winRate: r.winRate,
        winnerName: r.winnerBizNo ? (nm.get(r.winnerBizNo) ?? null) : null,
        nValid: r.nValid, nBids: g ? Number(g.nBids) : null,
        gap12: g?.secondRate != null && r.winRate != null ? +(g.secondRate - r.winRate).toFixed(3) : null,
      };
    });
  }

  /** 월별 보드 — 월×품목 집계 (건수·낙찰률 중앙값·기초금액 합계) */
  @Get("monthly")
  async monthly(@Query("months") monthsStr?: string, @Query("sigungu") sigungu?: string) {
    const months = Math.min(Number(monthsStr) || 12, 36);
    const rows = await db.select({
      openedAt: schoolAuctions.openedAt, category: schoolAuctions.category,
      winRate: schoolAuctions.winRate, basePrice: schoolAuctions.basePrice,
    }).from(schoolAuctions)
      .where(sigungu
        ? inArray(sql`split_part(school_id, '|', 1)`, sigungu.split(",").map(x => x.trim()).filter(Boolean))
        : undefined);
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
    const co = cutoff.toISOString().slice(0, 7);
    const cell = new Map<string, { n: number; wins: number[]; sumBase: number }>();
    for (const r of rows) {
      const m = r.openedAt?.slice(0, 7);
      if (!m || m < co) continue;
      const k = `${m}|${r.category ?? "기타"}`;
      const c = cell.get(k) ?? { n: 0, wins: [], sumBase: 0 };
      c.n++; if (r.winRate != null) c.wins.push(r.winRate);
      c.sumBase += r.basePrice ?? 0; cell.set(k, c);
    }
    return [...cell.entries()].map(([k, c]) => {
      const [month, cat] = k.split("|");
      const w = c.wins.sort((a, b) => a - b);
      return { month, category: cat, n: c.n, medWin: w.length ? +w[Math.floor(w.length / 2)].toFixed(3) : null, sumBase: c.sumBase };
    }).sort((a, b) => b.month.localeCompare(a.month));
  }
}

@Controller("market")
class MarketController {
  @Get()
  async list(@Query("category") category?: string) {
    return db.select().from(marketRegions)
      .where(category ? eq(marketRegions.category, category) : undefined)
      .orderBy(desc(marketRegions.expWin));
  }
}

@Controller("firms")
class FirmsController {
  private parse(csv: string) {
    return (csv ?? "").split(",").map(s => s.trim().replace(/-/g, "")).filter(Boolean);
  }

  /** 투찰 상세 — 행당 3단(낙찰가/2등가/내 값) 재료 */
  @Get("bids")
  async bids(@Query("bizNos") bizNosCsv: string, @Query("limit") limitStr?: string) {
    const bizNos = this.parse(bizNosCsv);
    if (!bizNos.length) return [];
    const limit = Math.min(Number(limitStr) || 300, 1000);
    const rows = await db.select().from(firmBids)
      .where(inArray(firmBids.bizNo, bizNos))
      .orderBy(desc(firmBids.openedAt)).limit(limit);
    const ids = [...new Set(rows.map(r => r.bidId))];
    const agg = ids.length ? await db.select({
      bidId: firmBids.bidId,
      secondRate: sql<number | null>`min(bid_rate) filter (where win_rate is not null and bid_rate > win_rate)`,
      nBids: sql<number>`count(*)`,
    }).from(firmBids).where(inArray(firmBids.bidId, ids)).groupBy(firmBids.bidId) : [];
    const byId = new Map(agg.map(a => [a.bidId, a]));
    const sas = ids.length ? await db.select().from(schoolAuctions).where(inArray(schoolAuctions.bidId, ids)) : [];
    const saById = new Map(sas.map(a => [a.bidId, a]));
    return rows.map(r => {
      const g = byId.get(r.bidId);
      const sa = saById.get(r.bidId);
      const effFloor = sa?.plannedPrice != null && sa.basePrice
        ? +(sa.floorRate! * sa.plannedPrice / sa.basePrice).toFixed(4) : null;
      return {
        bidId: r.bidId, bizNo: r.bizNo, openedAt: r.openedAt, schoolName: r.schoolName,
        sigungu: r.sigungu, category: sa?.category ?? null,
        basePrice: r.basePrice, floorRate: r.floorRate,
        bidRate: r.bidRate, won: r.won === 1,
        winRate: r.winRate, secondRate: g?.secondRate ?? null, nBids: g ? Number(g.nBids) : null,
        effFloor,
      };
    });
  }

  /** 성적표 — 사업자번호 콤마목록(워크스페이스 합산) */
  @Get("record")
  async record(@Query("bizNos") bizNosCsv: string) {
    const bizNos = this.parse(bizNosCsv);
    if (!bizNos.length) return { bizNos: [], totalBids: 0, totalWins: 0, pushedOut: 0, belowFloor: 0, regions: [], recentWins: [] };
    const rows = await db.select().from(firmBids).where(inArray(firmBids.bizNo, bizNos));
    const fs = await db.select().from(firms).where(inArray(firms.bizNo, bizNos));
    const lost = rows.filter(r => !r.won);
    // 진 이유: 투찰률 < 하한율 → 하한 미달(무효), 그 외 → 더 낮은 업체에 밀림
    const belowFloor = lost.filter(r => r.bidRate != null && r.floorRate != null && r.bidRate < r.floorRate).length;
    const recentWins = rows.filter(r => r.won)
      .sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""))
      .slice(0, 10)
      .map(r => ({ openedAt: r.openedAt, schoolName: r.schoolName, sigungu: r.sigungu, basePrice: r.basePrice, bidRate: r.bidRate }));
    return {
      bizNos,
      totalBids: rows.length,
      totalWins: rows.length - lost.length,
      pushedOut: lost.length - belowFloor,
      belowFloor,
      regions: [...new Set(fs.flatMap(f => f.regions ?? []))],
      recentWins,
    };
  }

  /** 월별 투찰/낙찰 추이 */
  @Get("timeline")
  async timeline(@Query("bizNos") bizNosCsv: string) {
    const bizNos = this.parse(bizNosCsv);
    if (!bizNos.length) return [];
    const rows = await db.select({ openedAt: firmBids.openedAt, won: firmBids.won })
      .from(firmBids).where(inArray(firmBids.bizNo, bizNos));
    const byYm = new Map<string, { bids: number; wins: number }>();
    for (const r of rows) {
      const ym = (r.openedAt ?? "").slice(0, 7);
      if (!ym) continue;
      const e = byYm.get(ym) ?? { bids: 0, wins: 0 };
      e.bids++; if (r.won) e.wins++;
      byYm.set(ym, e);
    }
    return [...byYm.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, v]) => ({ ym, ...v }));
  }

  /** 학교별 내 전적 뱃지 배치 조회 */
  @Get("badges")
  async badges(@Query("bizNos") bizNosCsv: string, @Query("schools") schoolsCsv: string) {
    const bizNos = this.parse(bizNosCsv);
    const names = (schoolsCsv ?? "").split(",").map(x => x.trim()).filter(Boolean);
    if (!bizNos.length || !names.length) return {};
    const rows = await db.select().from(firmBids)
      .where(and(inArray(firmBids.bizNo, bizNos), inArray(firmBids.schoolName, names)));
    const out: Record<string, { part: number; wins: number }> = {};
    for (const r of rows) {
      const k = r.schoolName!; out[k] ??= { part: 0, wins: 0 };
      out[k].part++; if (r.won) out[k].wins++;
    }
    return out;
  }

  /** 사업자번호 확인(온보딩): 존재 여부 + 이름 */
  /** 업체 검색 — 이름 부분일치 또는 사업자번호 */
  @Get("search")
  async search(@Query("q") q: string) {
    const t = (q ?? "").trim();
    if (t.length < 2) return [];
    const bz = t.replace(/-/g, "");
    return db.select({ bizNo: firms.bizNo, name: firms.name, totalBids: firms.totalBids, totalWins: firms.totalWins })
      .from(firms)
      .where(/^\d+$/.test(bz) ? ilike(firms.bizNo, `${bz}%`) : ilike(firms.name, `%${t}%`))
      .orderBy(desc(firms.totalBids)).limit(20);
  }

  /** 최다 낙찰 TOP — 최근 N개월 낙찰 순 */
  @Get("top")
  async top(@Query("months") monthsStr?: string) {
    const months = Math.min(Number(monthsStr) || 12, 60);
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
    const co = cutoff.toISOString().slice(0, 10);
    const rows = await db.select({
      bizNo: firmBids.bizNo,
      wins: sql<number>`count(*) filter (where won = 1)`,
      part: sql<number>`count(*)`,
      winSum: sql<number>`coalesce(sum(base_price * bid_rate / 100) filter (where won = 1), 0)`,
    }).from(firmBids)
      .where(gte(firmBids.openedAt, co))
      .groupBy(firmBids.bizNo)
      .orderBy(desc(sql`count(*) filter (where won = 1)`))
      .limit(15);
    const names = await db.select({ bizNo: firms.bizNo, name: firms.name }).from(firms)
      .where(inArray(firms.bizNo, rows.map(r => r.bizNo)));
    const nm = new Map(names.map(n => [n.bizNo, n.name]));
    return rows.filter(r => Number(r.wins) > 0).map(r => ({
      bizNo: r.bizNo, name: nm.get(r.bizNo) ?? r.bizNo,
      wins: Number(r.wins), part: Number(r.part), winSum: Math.round(Number(r.winSum)),
    }));
  }

  @Get("lookup")
  async lookup(@Query("bizNo") bizNo: string) {
    const bz = (bizNo ?? "").replace(/-/g, "").trim();
    const [f] = await db.select().from(firms).where(eq(firms.bizNo, bz)).limit(1);
    return f ? { found: true, bizNo: f.bizNo, name: f.name, totalBids: f.totalBids, totalWins: f.totalWins }
             : { found: false, bizNo: bz };
  }
}


@Controller("rounds")
class RoundsController {
  /** 학교의 회차별 경계 — 무효 확정 상한(maxInvalid)·2등가·참여수. 리허설/마진 평면의 재료 */
  @Get("school/:id")
  async school(@Param("id") id: string) {
    const aus = await db.select().from(schoolAuctions)
      .where(eq(schoolAuctions.schoolId, id)).orderBy(schoolAuctions.openedAt);
    if (aus.length === 0) return [];
    const ids = aus.map(a => a.bidId);
    const agg = await db.select({
      bidId: firmBids.bidId,
      nBids: sql<number>`count(*)`,
      maxInvalid: sql<number | null>`max(bid_rate) filter (where win_rate is not null and bid_rate < win_rate)`,
      secondRate: sql<number | null>`min(bid_rate) filter (where win_rate is not null and bid_rate > win_rate)`,
    }).from(firmBids).where(inArray(firmBids.bidId, ids)).groupBy(firmBids.bidId);
    const byId = new Map(agg.map(a => [a.bidId, a]));
    const wBizs = [...new Set(aus.map(a => a.winnerBizNo).filter(Boolean))] as string[];
    const wNames = wBizs.length ? await db.select({ bizNo: firms.bizNo, name: firms.name })
      .from(firms).where(inArray(firms.bizNo, wBizs)) : [];
    const wnm = new Map(wNames.map(n => [n.bizNo, n.name]));
    return aus.map(a => {
      const g = byId.get(a.bidId);
      // 실효 하한율 = 하한율 × 예정가/기초가 (예정가 보유 회차는 판정 확정)
      const effFloor = a.plannedPrice != null && a.basePrice
        ? +(a.floorRate! * a.plannedPrice / a.basePrice).toFixed(4) : null;
      return {
        bidId: a.bidId, openedAt: a.openedAt, category: a.category,
        floorRate: a.floorRate, winRate: a.winRate, basePrice: a.basePrice,
        nValid: a.nValid, winnerBiz: a.winnerBizNo ?? null,
        winnerName: a.winnerBizNo ? (wnm.get(a.winnerBizNo) ?? null) : null,
        nBids: g ? Number(g.nBids) : null,
        maxInvalid: g?.maxInvalid ?? null,
        secondRate: g?.secondRate ?? null,
        plannedPrice: a.plannedPrice ?? null,
        effFloor,
        reserves: a.reserves ?? null,
      };
    });
  }

  /** 개찰 리플레이 — 한 회차의 전체 투찰 분포 */
  @Get(":bidId")
  async replay(@Param("bidId") bidId: string) {
    const bids = await db.select({
      bizNo: firmBids.bizNo, bidRate: firmBids.bidRate, won: firmBids.won,
      winRate: firmBids.winRate, floorRate: firmBids.floorRate,
      openedAt: firmBids.openedAt, basePrice: firmBids.basePrice, schoolName: firmBids.schoolName,
    }).from(firmBids).where(eq(firmBids.bidId, bidId));
    if (bids.length === 0) return { bids: [], meta: null };
    const names = await db.select({ bizNo: firms.bizNo, name: firms.name }).from(firms)
      .where(inArray(firms.bizNo, [...new Set(bids.map(b => b.bizNo))]));
    const nm = new Map(names.map(n => [n.bizNo, n.name]));
    const m = bids[0];
    const winRate = m.winRate;
    const rows = bids.filter(b => b.bidRate != null).map(b => ({
      bizNo: b.bizNo, name: nm.get(b.bizNo) ?? b.bizNo, bidRate: b.bidRate!,
      won: b.won === 1,
      status: b.won === 1 ? "낙찰" : winRate != null && b.bidRate! < winRate ? "하한미달" : "밀림",
    })).sort((a, b) => a.bidRate - b.bidRate);
    const valid = rows.filter(r => r.status !== "하한미달");
    const runnerUp = winRate != null ? valid.find(r => !r.won && r.bidRate > winRate) : undefined;
    const gap12 = runnerUp && winRate != null ? +(runnerUp.bidRate - winRate).toFixed(3) : null;
    const maxInvalid = rows.filter(r => r.status === "하한미달").at(-1)?.bidRate ?? null;
    return {
      meta: {
        bidId, openedAt: m.openedAt, schoolName: m.schoolName, basePrice: m.basePrice,
        floorRate: m.floorRate, winRate, n: rows.length, nValid: valid.length,
        gap12, maxInvalid,
      },
      bids: rows,
    };
  }
}

@Controller()
class HealthController {
  @Get("healthz")
  health() { return { ok: true, ts: new Date().toISOString() }; }
}

@Module({
  controllers: [HealthController, RoundsController, WinsController, SchoolsController, OpenController, MarketController, FirmsController, ResultsController],
})
export class AppModule {}
