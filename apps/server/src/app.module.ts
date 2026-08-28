import { Module, Controller, Get, Post, Put, Body, Query, Param, Req, Res, All } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { eq, ilike, and, desc, inArray, sql, gte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createHmac, timingSafeEqual } from "crypto";
import {
  SchoolsQuery, OpenQuery, schools, schoolAuctions, openAuctions, marketRegions, firmBids, firms, schoolRoster, schoolRosterCat, events,
  userBiz, userRegion, userMark,
} from "@eatbid/shared";
import { db } from "./db";
import { auth, getSessionUser } from "./auth";

/** zod 계약 → DTO. 검증은 전역 ZodValidationPipe가 수행 */
class SchoolsQueryDto extends createZodDto(SchoolsQuery) {}
class OpenQueryDto extends createZodDto(OpenQuery) {}

@Controller("schools")
class SchoolsController {
  @Get()
  async list(@Query() q: SchoolsQueryDto) {
    const conds = [];
    if (q.sigungu) conds.push(eq(schools.sigungu, q.sigungu));
    // 학교의 품목 필터도 포함 기준 — cat_counts 에 그 품목이 있으면 해당된다.
    if (q.category) conds.push(sql`(cat_counts ? ${q.category} or (cat_counts is null and category = ${q.category}))`);
    if (q.q) conds.push(ilike(schools.name, `%${q.q}%`));
    return db.select().from(schools)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schools.nAuctions))
      .limit(q.limit).offset(q.offset);
  }

  private forecastCache = new Map<string, { at: number; data: any }>();

  @Get("forecast")
  async forecast(@Query("sigungu") sigungu?: string) {
    const sggs = (sigungu ?? "").split(",").map(x => x.trim()).filter(Boolean);
    const ckey = sggs.slice().sort().join(",");
    const hit = this.forecastCache.get(ckey);
    if (hit && Date.now() - hit.at < 600_000) return hit.data;
    // 지역 지정 시 SQL에서 선필터 — 전량 스캔 방지 (P2)
    const rows = await db.select({
      schoolId: schoolAuctions.schoolId, openedAt: schoolAuctions.openedAt, winRate: schoolAuctions.winRate,
    }).from(schoolAuctions)
      .where(sggs.length ? inArray(sql`split_part(school_id, '|', 1)`, sggs) : undefined)
      .orderBy(schoolAuctions.schoolId, schoolAuctions.openedAt);
    const bySchool = new Map<string, string[]>();
    const lastWin = new Map<string, number>();
    for (const r of rows) {
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
    const res = out.sort((a, b) => a.dueInDays - b.dueInDays);
    this.forecastCache.set(ckey, { at: Date.now(), data: res });
    return res;
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

  /**
   * 단골 참여 업체 — 사실 전부. 해석 라벨 없음.
   * category 를 주면 그 품목만(school_roster_cat), 없으면 전 품목 혼합(school_roster).
   * 축산 사장에게 수산 조합이 보이던 문제(S-1)는 품목을 줘야 닫힌다.
   * basis 로 지금 무슨 분모를 보고 있는지 화면이 말할 수 있게 한다.
   */
  @Get(":id/roster")
  async roster(@Param("id") id: string, @Query("category") category?: string) {
    const cat = (category ?? "").trim();
    const rows = cat
      ? await db.select().from(schoolRosterCat)
          .where(and(eq(schoolRosterCat.schoolId, id), eq(schoolRosterCat.category, cat)))
          .orderBy(desc(schoolRosterCat.partN)).limit(30)
      : await db.select().from(schoolRoster)
          .where(eq(schoolRoster.schoolId, id))
          .orderBy(desc(schoolRoster.partN)).limit(30);
    // 사실 문장 재료: 이 학교 연속 낙찰 최대 횟수. 품목을 주면 그 품목 회차만 본다.
    const aucs = await db.select({
      w: schoolAuctions.winnerBizNo,
      categories: schoolAuctions.categories,
      category: schoolAuctions.category,
    }).from(schoolAuctions).where(eq(schoolAuctions.schoolId, id))
      .orderBy(schoolAuctions.openedAt);
    const scoped = cat
      ? aucs.filter(a => catsOf(a.categories, a.category).includes(cat))
      : aucs;
    let maxStreak = 0, cur = 0; let prev: string | null = null;
    for (const a of scoped) {
      cur = a.w && a.w === prev ? cur + 1 : 1;
      prev = a.w; if (cur > maxStreak) maxStreak = cur;
    }
    return {
      rows, maxStreak,
      category: cat || null,
      basis: cat ? ("category" as const) : ("all-categories" as const),
      nRounds: scoped.length,
    };
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

/** 지역제한 없음 표기 — eaT 원본이 시군구명 대신 "전체"/"전국"을 담는 경우가 있다 */
const UNRESTRICTED_TOKENS = ["전체", "전국", "제한없음", "해당없음"];
/** 공고의 지역 제한이 사실상 없는가 (빈 목록 = 제한 정보 없음 = 무제한 취급) */
function isUnrestricted(allowed: string[] | null | undefined): boolean {
  const list = (allowed ?? []).map(x => (x ?? "").trim()).filter(Boolean);
  if (list.length === 0) return true;
  return list.some(a => UNRESTRICTED_TOKENS.some(t => a.includes(t)));
}
/** 자격 판정: 무제한이면 전원 자격, 아니면 허용 지역 x 사용자 지역 교집합 */
function eligibleFor(allowed: string[] | null | undefined, sigungu: string | null, mine: string[]): boolean {
  if (isUnrestricted(allowed)) return true;
  if (!mine.length) return true; // 자격 지역 미설정 사용자에겐 숨기지 않는다
  const list = (allowed ?? []).map(x => (x ?? "").trim()).filter(Boolean);
  // 부분문자열로 맞추고 있었다. `서구`가 `강서구`·`달서구`에, `북구`가 `강북구`·
  // `성북구`에, `동구`가 `성동구`에 걸린다 — 인천 서구 업체가 대구 달서구 공고를
  // "자격 충족"으로 봤다. 모르는 걸 안다고 단언하는 쪽이라 완전일치로 좁힌다.
  return mine.some(m => list.includes(m) || (sigungu ?? "") === m);
}

@Controller("open")
class OpenController {
  /** 공고에 학교 재료를 붙인다: 같은 하한 밴드·최근 낙찰 3개·보통 업체 수 */
  private async enrich(r: typeof openAuctions.$inferSelect) {
    const schoolId = r.sigungu && r.schoolName ? `${r.sigungu}|${r.schoolName}` : null;
    let band: unknown = null, recent3: number[] = [], usualN: number | null = null, nSameFloor = 0;
    // S-1: 품목별 재료. 합치지 않는다 — 합치는 것이 원죄였다.
    let byCat: Record<string, { band: unknown; recent3: number[]; nSameFloor: number }> = {};
    let catCounts: Record<string, number> | null = null;
    if (schoolId) {
      const [sc] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
      const floorKeys = r.floorRate != null
        ? [String(r.floorRate), r.floorRate.toFixed(1)]
        : [];
      if (sc && r.floorRate != null) {
        // 기존 band 는 전 품목 합산이다(bandBasis 로 그 사실을 밝힌다).
        const bf = (sc.byFloor ?? {}) as Record<string, any>;
        band = floorKeys.map(k => bf[k]).find(v => v != null) ?? null;
      }
      if (sc) catCounts = (sc.catCounts ?? null) as Record<string, number> | null;
      const aucs = await db.select().from(schoolAuctions)
        .where(eq(schoolAuctions.schoolId, schoolId))
        .orderBy(schoolAuctions.openedAt);
      const same = aucs.filter(a => r.floorRate == null || a.floorRate === r.floorRate);
      nSameFloor = same.length;
      recent3 = same.slice(-3).map(a => a.winRate).filter((x): x is number => x != null);
      const last10 = aucs.slice(-10).map(a => a.nValid).sort((a, b) => a - b);
      usualN = last10.length ? last10[Math.floor(last10.length / 2)] : null;

      // 이 공고의 품목마다 따로. 다중 품목이면 항목이 여럿 생긴다.
      const bcf = (sc?.byCatFloor ?? {}) as Record<string, any>;
      for (const c of catsOf(r.categories, r.category)) {
        const perFloor = bcf[c] ?? {};
        const b = floorKeys.map(k => perFloor[k]).find(v => v != null) ?? null;
        const sameCat = same.filter(a => catsOf(a.categories, a.category).includes(c));
        byCat[c] = {
          band: b,
          recent3: sameCat.slice(-3).map(a => a.winRate).filter((x): x is number => x != null),
          nSameFloor: sameCat.length,
        };
      }
    }
    const unrestricted = isUnrestricted(r.allowedRegions);
    const cats = catsOf(r.categories, r.category);
    return {
      ...r, schoolId,
      // 품목 사실: 대표(category)는 호환용, 실제는 categories 전부.
      categories: cats, isMultiCategory: cats.length > 1,
      categorySrc: r.categorySrc ?? null,
      // 이 목록의 품목 필터는 포함 기준이다(대표만 보지 않는다).
      countBasis: "inclusive" as const,
      // band/recent3/nSameFloor 는 전 품목 합산이다 — 그 사실을 밝힌다.
      bandBasis: "all-categories" as const,
      // 품목별 재료: { 축산: { band, recent3, nSameFloor } }. 화면은 이걸 써야 정확하다.
      byCat,
      // 이 학교의 품목별 회차 수 — "축산 24회" 표기의 원천.
      catCounts,
      anchorAmount: r.basePrice && r.floorRate ? Math.round(r.basePrice * r.floorRate / 100) : null,
      band, recent3, usualN, nSameFloor,
      // 표기용: 무제한이면 "지역 제한 없음", 아니면 허용 지역 나열
      unrestricted,
      allowedLabel: unrestricted ? "지역 제한 없음"
        : (r.allowedRegions ?? []).filter(Boolean).slice(0, 3).join(" · "),
      // 자격 판정의 근거 범위. 업체의 등록 품목은 eaT 원본에 존재하지 않아
      // (raw ds_bidList 31키 전수 확인) 지금 판정은 지역만 본 것이다.
      // 화면은 "자격 충족"이 아니라 "지역 자격 충족"이라고 말해야 한다.
      qualificationBasis: "region-only" as const,
    };
  }

  @Get()
  async list(@Query() q: OpenQueryDto) {
    const rows = await db.select().from(openAuctions);
    const mine = (q.region ?? "").split(",").map(x => x.trim()).filter(Boolean);
    const filtered = rows
      // region 파라미터 = 사용자 자격 지역(콤마 목록). 무제한 공고는 항상 통과.
      .filter(r => !mine.length || eligibleFor(r.allowedRegions, r.sigungu, mine))
      .filter(r => !q.category || catsOf(r.categories, r.category).includes(q.category));
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

/**
 * 품목 필터는 대표(category)가 아니라 포함(categories) 기준이다.
 * 사장이 "공산 공고"를 찾으면 공산이 포함된 공고가 전부 나와야 한다 —
 * 대표 기준이면 다중 품목 공고 15,604건이 화면에서 사라진다.
 * categories 가 아직 없는 행(구 적재분)은 대표로 대조한다.
 */
function catMatchSql(col: any, catCol: any, cat: string) {
  return sql`(${col} @> ${JSON.stringify([cat])}::jsonb or (${col} is null and ${catCol} = ${cat}))`;
}
/** 품목 배열이 비었으면 대표 하나로 채워 응답한다(구 적재분 호환) */
function catsOf(categories: string[] | null | undefined, category: string | null) {
  const list = (categories ?? []).filter(Boolean);
  if (list.length) return list;
  return category ? [category] : [];
}

const SGG_RE = /^[가-힣]{1,6}(시|군|구)$/;
/** 콤마 목록에서 정규 시군구 형식만 통과 */
function cleanSggs(csv?: string): string[] {
  return (csv ?? "").split(",").map(x => x.trim()).filter(x => SGG_RE.test(x));
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
    // 정규 시군구만: 형식(한글 1~6자 + 시/군/구) + 표본 n>=20.
    // schools 실존 조건은 걸지 않는다 — 학교별 5회 문턱에 못 미치는 소규모
    // 지역(밀양시 21회·의령군 52회)도 자기 지역을 골라볼 수 있어야 한다.
    return rows
      .filter(r => r.sgg && SGG_RE.test(r.sgg) && Number(r.n) >= 20)
      .map(r => ({ sigungu: r.sgg, n: Number(r.n) }));
  }

  /** 몰림 지도 — 최근 N일 전 지역 투찰값 분포 (0.01 단위). 동가 위험·빈 자리의 사실 */
  private crowdCache = new Map<string, { at: number; data: any }>();
  @Get("crowd")
  async crowd(@Query("days") daysStr?: string, @Query("floor") floorStr?: string) {
    const days = Math.min(Number(daysStr) || 14, 60);
    const floor = Number(floorStr) || 90;
    const key = `${days}|${floor}`;
    const hit = this.crowdCache.get(key);
    if (hit && Date.now() - hit.at < 600_000) return hit.data;
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const rows = await db.select({
      v: sql<number>`round(bid_rate::numeric, 2)`,
      n: sql<number>`count(*)`,
    }).from(firmBids)
      .where(and(gte(firmBids.openedAt, cutoff), eq(firmBids.floorRate, floor),
        sql`bid_rate >= ${floor} and bid_rate < ${floor + 1.5}`))
      .groupBy(sql`round(bid_rate::numeric, 2)`)
      .orderBy(sql`round(bid_rate::numeric, 2)`);
    const total = rows.reduce((s, r) => s + Number(r.n), 0);
    const data = { days, floor, total, bins: rows.map(r => ({ v: Number(r.v), n: Number(r.n) })) };
    this.crowdCache.set(key, data && { at: Date.now(), data });
    return data;
  }

  /** 개찰 속보 — 최근 개찰 결과 전량 (낙찰 업체명·1-2등차 포함) */
  @Get("recent")
  async recent(@Query("days") daysStr?: string, @Query("category") category?: string,
    @Query("sigungu") sigungu?: string, @Query("limit") limitStr?: string,
    @Query("withTotal") withTotal?: string, @Query("bizNos") bizNosCsv?: string) {
    const days = Math.min(Number(daysStr) || 30, 180);
    const limit = Math.min(Number(limitStr) || 400, 1000);
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const conds = [gte(schoolAuctions.openedAt, cutoff)];
    if (category) conds.push(catMatchSql(schoolAuctions.categories, schoolAuctions.category, category));
    const sggs = cleanSggs(sigungu);
    if (sggs.length === 1) conds.push(ilike(schoolAuctions.schoolId, `${sggs[0]}|%`));
    else if (sggs.length > 1) conds.push(inArray(sql`split_part(school_id, '|', 1)`, sggs));
    const total = withTotal === "1"
      ? Number((await db.select({ n: sql<number>`count(*)` }).from(schoolAuctions).where(and(...conds)))[0].n)
      : null;
    const rows = await db.select().from(schoolAuctions)
      .where(and(...conds)).orderBy(desc(schoolAuctions.openedAt)).limit(limit);
    const ids = rows.map(r => r.bidId);
    const agg = ids.length ? await db.select({
      bidId: firmBids.bidId,
      nBids: sql<number>`count(*)`,
      secondRate: sql<number | null>`min(bid_rate) filter (where win_rate is not null and bid_rate > win_rate)`,
    }).from(firmBids).where(inArray(firmBids.bidId, ids)).groupBy(firmBids.bidId) : [];
    const byId = new Map(agg.map(a => [a.bidId, a]));
    // mine 플래그 — 그 회차에 해당 사업자의 투찰 존재 여부만 (값 비노출)
    const myBizNos = (bizNosCsv ?? "").split(",").map(x => x.trim().replace(/-/g, "")).filter(Boolean);
    const mineSet = myBizNos.length && ids.length
      ? new Set((await db.select({ bidId: firmBids.bidId }).from(firmBids)
          .where(and(inArray(firmBids.bidId, ids), inArray(firmBids.bizNo, myBizNos)))).map(x => x.bidId))
      : null;
    const bizs = [...new Set(rows.map(r => r.winnerBizNo).filter(Boolean))] as string[];
    const names = bizs.length ? await db.select({ bizNo: firms.bizNo, name: firms.name })
      .from(firms).where(inArray(firms.bizNo, bizs)) : [];
    const nm = new Map(names.map(n => [n.bizNo, n.name]));
    const out = rows.map(r => {
      const g = byId.get(r.bidId);
      return {
        bidId: r.bidId, schoolId: r.schoolId, schoolName: r.schoolId.split("|")[1] ?? r.schoolId,
        sigungu: r.schoolId.split("|")[0] ?? null, category: r.category, openedAt: r.openedAt,
        basePrice: r.basePrice, floorRate: r.floorRate, winRate: r.winRate,
        winnerName: r.winnerBizNo ? (nm.get(r.winnerBizNo) ?? null) : null,
        nValid: r.nValid, nBids: g ? Number(g.nBids) : null,
        gap12: g?.secondRate != null && r.winRate != null ? +(g.secondRate - r.winRate).toFixed(3) : null,
        dlvryStart: r.dlvryStart ?? null, dlvryEnd: r.dlvryEnd ?? null,
        categories: catsOf(r.categories, r.category),
        categorySrc: r.categorySrc ?? null,
        mine: mineSet ? mineSet.has(r.bidId) : undefined,
      };
    });
    return total != null
      ? { rows: out, total, countBasis: "inclusive" as const }
      : out;
  }

  /** 월별 보드 — 월×품목 집계 (건수·낙찰률 중앙값·기초금액 합계) */
  private monthlyCache = new Map<string, { at: number; data: any }>();

  @Get("monthly")
  async monthly(@Query("months") monthsStr?: string, @Query("sigungu") sigungu?: string) {
    const months = Math.min(Number(monthsStr) || 12, 36);
    const mkey = `${months}|${cleanSggs(sigungu).slice().sort().join(",")}`;
    const mhit = this.monthlyCache.get(mkey);
    if (mhit && Date.now() - mhit.at < 600_000) return mhit.data;
    const rows = await db.select({
      openedAt: schoolAuctions.openedAt, category: schoolAuctions.category,
      categories: schoolAuctions.categories,
      winRate: schoolAuctions.winRate, basePrice: schoolAuctions.basePrice,
    }).from(schoolAuctions)
      .where(cleanSggs(sigungu).length
        ? inArray(sql`split_part(school_id, '|', 1)`, cleanSggs(sigungu))
        : undefined);
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
    const co = cutoff.toISOString().slice(0, 7);
    // 집계는 대표(category) 기준이다 — 다중 품목을 여러 칸에 넣으면 칸 합계가
    // 총계를 넘어 "이번 달 몇 건인가"에 답할 수 없게 된다.
    // 대신 각 칸에 (a) 이 칸이 대표인데 실제로는 다중인 회차 수(nMulti)와
    // (b) 대표는 다른 품목이지만 이 품목을 포함하는 회차 수(nAlsoIn)를 함께 낸다.
    // 필터(포함 기준) 결과와 칸 합계의 차이를 화면이 스스로 설명할 수 있게 하는 재료다.
    const cell = new Map<string, { n: number; wins: number[]; sumBase: number; nMulti: number }>();
    const alsoIn = new Map<string, number>();
    for (const r of rows) {
      const m = r.openedAt?.slice(0, 7);
      if (!m || m < co) continue;
      const rep = r.category ?? "기타";
      const cats = (r.categories ?? []).filter(Boolean);
      const k = `${m}|${rep}`;
      const c = cell.get(k) ?? { n: 0, wins: [], sumBase: 0, nMulti: 0 };
      c.n++; if (r.winRate != null) c.wins.push(r.winRate);
      c.sumBase += r.basePrice ?? 0;
      if (cats.length > 1) c.nMulti++;
      cell.set(k, c);
      for (const other of cats) {
        if (other === rep) continue;
        const ak = `${m}|${other}`;
        alsoIn.set(ak, (alsoIn.get(ak) ?? 0) + 1);
      }
    }
    const res = [...cell.entries()].map(([k, c]) => {
      const [month, cat] = k.split("|");
      const w = c.wins.sort((a, b) => a - b);
      return {
        month, category: cat, n: c.n,
        medWin: w.length ? +w[Math.floor(w.length / 2)].toFixed(3) : null,
        sumBase: c.sumBase,
        nMulti: c.nMulti,
        nAlsoIn: alsoIn.get(k) ?? 0,
        countBasis: "primary" as const,
      };
    }).sort((a, b) => b.month.localeCompare(a.month));
    this.monthlyCache.set(mkey, { at: Date.now(), data: res });
    return res;
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
  async bids(@Query("bizNos") bizNosCsv: string, @Query("limit") limitStr?: string,
    @Query("withTotal") withTotal?: string, @Query("summary") summary?: string,
    @Query("months") monthsStr?: string) {
    const bizNos = this.parse(bizNosCsv);
    if (!bizNos.length) return [];
    // U11: 행 배열 없이 KPI만 — 전체 기준 수치를 싸게 (SQL 집계 1~2회)
    if (summary === "1") {
      const conds = [inArray(firmBids.bizNo, bizNos)];
      const months = Number(monthsStr);
      if (Number.isFinite(months) && months > 0) {
        const cut = new Date(); cut.setMonth(cut.getMonth() - months);
        conds.push(gte(firmBids.openedAt, cut.toISOString().slice(0, 10)));
      }
      const [agg] = await db.select({
        part: sql<number>`count(*)`,
        wins: sql<number>`count(*) filter (where won = 1)`,
        below: sql<number>`count(*) filter (where won = 0 and bid_rate is not null and win_rate is not null and bid_rate < win_rate)`,
        pushed: sql<number>`count(*) filter (where won = 0 and bid_rate is not null and win_rate is not null and bid_rate >= win_rate)`,
        winSum: sql<number>`coalesce(sum(base_price * bid_rate / 100) filter (where won = 1), 0)`,
      }).from(firmBids).where(and(...conds));
      // 아깝게 진 판 = 내가 2등(승자 위 최저가가 내 값)
      const runner = await db.select({
        diff: sql<number>`round((fb.bid_rate - fb.win_rate)::numeric, 3)`,
      }).from(sql`${firmBids} fb`)
        // any(${bizNos}) 는 JS 배열을 문자열로 바인딩해 `malformed array literal` 로 죽는다.
        // 이 엔드포인트가 100% 500 이었고, 웹은 .catch 로 삼켜 KPI 가 조용히 비어 있었다.
        .where(sql`fb.biz_no in ${bizNos} and fb.won = 0 and fb.bid_rate is not null and fb.win_rate is not null
          and fb.bid_rate > fb.win_rate
          and not exists (select 1 from firm_bids o where o.bid_id = fb.bid_id
            and o.bid_rate > fb.win_rate and o.bid_rate < fb.bid_rate)`);
      const diffs = runner.map(r => Number(r.diff)).filter(Number.isFinite).sort((a, b) => a - b);
      return {
        part: Number(agg.part), wins: Number(agg.wins),
        pushed: Number(agg.pushed), below: Number(agg.below),
        winRatePct: Number(agg.part) ? +(Number(agg.wins) / Number(agg.part) * 100).toFixed(1) : 0,
        winSum: Math.round(Number(agg.winSum)),
        runnerUp: { n: diffs.length, medDiff: diffs.length ? diffs[Math.floor(diffs.length / 2)] : null },
      };
    }
    const limit = Math.min(Number(limitStr) || 2000, 5000);
    const total = withTotal === "1"
      ? Number((await db.select({ n: sql<number>`count(*)` }).from(firmBids).where(inArray(firmBids.bizNo, bizNos)))[0].n)
      : null;
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
    const out = rows.map(r => {
      const g = byId.get(r.bidId);
      const sa = saById.get(r.bidId);
      const effFloor = sa?.plannedPrice != null && sa.basePrice
        ? +(sa.floorRate! * sa.plannedPrice / sa.basePrice).toFixed(4) : null;
      return {
        dlvryStart: sa?.dlvryStart ?? null, dlvryEnd: sa?.dlvryEnd ?? null,
        bidId: r.bidId, bizNo: r.bizNo, openedAt: r.openedAt, schoolName: r.schoolName,
        sigungu: r.sigungu, category: sa?.category ?? null,
        basePrice: r.basePrice, floorRate: r.floorRate,
        bidRate: r.bidRate, won: r.won === 1,
        winRate: r.winRate, secondRate: g?.secondRate ?? null, nBids: g ? Number(g.nBids) : null,
        effFloor,
      };
    });
    return total != null ? { rows: out, total } : out;
  }

  /** 동가 이력 — 같은 회차·같은 값에 나 포함 2곳 이상 선 회차 (사실 나열, 집계 없음) */
  @Get("ties")
  async ties(@Query("bizNos") bizNosCsv: string) {
    const bizNos = this.parse(bizNosCsv);
    if (!bizNos.length) return [];
    const other = alias(firmBids, "tie_other");
    const rows = await db.select({
      openedAt: firmBids.openedAt, schoolName: firmBids.schoolName, sigungu: firmBids.sigungu,
      bidRate: firmBids.bidRate, won: firmBids.won, winRate: firmBids.winRate,
      nTied: sql<number>`count(*)`,
    }).from(firmBids)
      .innerJoin(other, and(eq(other.bidId, firmBids.bidId), sql`${other.bidRate} = ${firmBids.bidRate}`))
      .where(and(inArray(firmBids.bizNo, bizNos), sql`${firmBids.bidRate} is not null`))
      .groupBy(firmBids.bidId, firmBids.bizNo, firmBids.openedAt, firmBids.schoolName,
        firmBids.sigungu, firmBids.bidRate, firmBids.won, firmBids.winRate)
      .having(sql`count(*) >= 2`)
      .orderBy(desc(firmBids.openedAt))
      .limit(100);
    return rows.map(r => ({
      openedAt: r.openedAt, schoolName: r.schoolName, sigungu: r.sigungu,
      bidRate: r.bidRate, nTied: Number(r.nTied), won: r.won === 1, winRate: r.winRate,
    }));
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
  private topCache = new Map<string, { at: number; data: any }>();

  @Get("top")
  async top(@Query("months") monthsStr?: string) {
    const months = Math.min(Number(monthsStr) || 12, 60);
    const thit = this.topCache.get(String(months));
    if (thit && Date.now() - thit.at < 600_000) return thit.data;
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
    const tres = rows.filter(r => Number(r.wins) > 0).map(r => ({
      bizNo: r.bizNo, name: nm.get(r.bizNo) ?? r.bizNo,
      wins: Number(r.wins), part: Number(r.part), winSum: Math.round(Number(r.winSum)),
    }));
    this.topCache.set(String(months), { at: Date.now(), data: tres });
    return tres;
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

/**
 * 성적 공유 토큰 — HMAC-SHA256 서명, 30일 만료.
 * 각주(critic 조건): base64url 인코딩은 은닉이 아니다 — 토큰을 디코드하면
 * bizNo가 그대로 보인다. 서명은 위조 방지일 뿐이며, 노출 범위 제한은
 * GET 응답을 요약(합계+최근 낙찰 5건)으로 한정하는 것으로 달성한다.
 */
/** Better Auth 핸들러 — /api/auth/* 전량 위임 (소셜 콜백·세션·로그아웃) */
@Controller("auth")
class AuthController {
  @All("*path")
  async handle(@Req() req: any, @Res() res: any) {
    const url = new URL(req.originalUrl ?? req.url, process.env.BETTER_AUTH_URL || "http://localhost:8081");
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers ?? {})) {
      if (typeof v === "string") headers.set(k, v);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(url, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    });
    const response = await auth.handler(request);
    res.status(response.status);
    response.headers.forEach((val: string, key: string) => res.setHeader(key, val));
    res.send(await response.text());
  }
}

/**
 * 회차별 마크를 사업자 축으로 묶는다.
 * 반환: { [bidNo]: { s, rates: { [bizNo]: rate }, rate } }
 *  - rates: 사업자별 값. 키 ''는 미지정(사업자 등록 전 저장분).
 *  - rate: 구 형식 미러 — front가 아직 단일 값을 읽고 있어 함께 내보낸다.
 *          우선순위는 ''(미지정) → 첫 사업자.
 */
function groupMarks(rows: { bidNo: string; bizNo: string; status: string; rate: number | null }[]) {
  const out: Record<string, { s: string; rates: Record<string, number>; rate?: number }> = {};
  for (const m of rows) {
    const e = out[m.bidNo] ?? (out[m.bidNo] = { s: m.status, rates: {} });
    if (m.rate != null) e.rates[m.bizNo] = m.rate;
  }
  for (const e of Object.values(out)) {
    const keys = Object.keys(e.rates);
    const pick = keys.includes("") ? "" : keys[0];
    if (pick != null) e.rate = e.rates[pick];
  }
  return out;
}

/**
 * 계정 데이터 — 세션 있으면 서버(user_biz/user_region/user_mark), 없으면 401.
 * 웹은 401을 받으면 localStorage 폴백을 계속 쓴다(게스트 모드 유지).
 */
@Controller("me")
class MeController {
  private async uid(req: any) {
    const u = await getSessionUser(req.headers);
    return u?.userId ?? null;
  }

  @Get()
  async me(@Req() req: any) {
    const googleEnabled = !!process.env.GOOGLE_CLIENT_ID;
    const u = await getSessionUser(req.headers);
    if (!u) return { ok: true, guest: true, user: null, googleEnabled };
    const [bizs, regions, marks] = await Promise.all([
      db.select().from(userBiz).where(eq(userBiz.userId, u.userId)),
      db.select().from(userRegion).where(eq(userRegion.userId, u.userId)),
      db.select().from(userMark).where(eq(userMark.userId, u.userId)),
    ]);
    return {
      ok: true, guest: false, googleEnabled,
      user: { id: u.userId, email: u.email, name: u.name },
      bizNos: bizs.map(b => b.bizNo),
      regions: regions.map(r => r.sigungu),
      marks: groupMarks(marks),
    };
  }

  /** 전체 치환 저장 — 게스트→로그인 병합도 이 경로로 (웹이 합쳐서 PUT) */
  @Put("biz")
  async putBiz(@Req() req: any, @Body() body: unknown) {
    const uid = await this.uid(req);
    if (!uid) return { ok: false, error: "unauthenticated" };
    const p = z.object({ bizNos: z.array(z.string().regex(/^\d{10}$/)).max(20) }).safeParse(body);
    if (!p.success) return { ok: false, error: "bad_request" };
    await db.delete(userBiz).where(eq(userBiz.userId, uid));
    if (p.data.bizNos.length)
      await db.insert(userBiz).values(p.data.bizNos.map(b => ({ userId: uid, bizNo: b })));
    return { ok: true, n: p.data.bizNos.length };
  }

  @Put("regions")
  async putRegions(@Req() req: any, @Body() body: unknown) {
    const uid = await this.uid(req);
    if (!uid) return { ok: false, error: "unauthenticated" };
    const p = z.object({ regions: z.array(z.string().max(40)).max(50) }).safeParse(body);
    if (!p.success) return { ok: false, error: "bad_request" };
    await db.delete(userRegion).where(eq(userRegion.userId, uid));
    if (p.data.regions.length)
      await db.insert(userRegion).values(p.data.regions.map(r => ({ userId: uid, sigungu: r })));
    return { ok: true, n: p.data.regions.length };
  }

  @Put("marks")
  async putMarks(@Req() req: any, @Body() body: unknown) {
    const uid = await this.uid(req);
    if (!uid) return { ok: false, error: "unauthenticated" };
    // 신 형식(rates: 사업자별 값)과 구 형식(rate: 단일 값)을 함께 받는다 —
    // front가 미러를 아직 쓰고 있어, 구 형식을 끊으면 값이 사라진다.
    const p = z.object({
      marks: z.record(z.string().max(32), z.object({
        s: z.enum(["watch", "done"]),
        rate: z.number().optional(),
        rates: z.record(z.string().max(16), z.number()).optional(),
      })),
    }).safeParse(body);
    if (!p.success) return { ok: false, error: "bad_request" };
    const rows: { userId: string; bidNo: string; bizNo: string; status: string; rate: number | null }[] = [];
    for (const [bidNo, m] of Object.entries(p.data.marks).slice(0, 500)) {
      const entries = m.rates && Object.keys(m.rates).length
        ? Object.entries(m.rates)
        : ([["", m.rate ?? null]] as [string, number | null][]);
      for (const [bizNo, rate] of entries.slice(0, 20)) {
        rows.push({ userId: uid, bidNo, bizNo, status: m.s, rate: rate ?? null });
      }
    }
    await db.delete(userMark).where(eq(userMark.userId, uid));
    if (rows.length) await db.insert(userMark).values(rows);
    return { ok: true, n: rows.length, bids: Object.keys(p.data.marks).length };
  }
}

@Controller("share")
class ShareController {
  private secret() { return process.env.EATBID_SHARE_SECRET || "dev-insecure-secret"; }
  private b64u(b: Buffer) { return b.toString("base64url"); }
  private sign(payload: string) {
    return createHmac("sha256", this.secret()).update(payload).digest();
  }
  /** 세션당 시간당 10개 발급 제한 (메모리) */
  private quota = new Map<string, { h: number; c: number }>();

  @Post()
  async create(@Body() body: unknown) {
    const Req = z.object({
      bizNo: z.string().regex(/^\d{10}$/),
      session: z.string().min(1).max(64),
    });
    const p = Req.safeParse(body);
    if (!p.success) return { ok: false, error: "bad_request" };
    const hour = Math.floor(Date.now() / 3600_000);
    const q = this.quota.get(p.data.session);
    if (q && q.h === hour && q.c >= 10) return { ok: false, error: "rate_limited" };
    this.quota.set(p.data.session, { h: hour, c: q && q.h === hour ? q.c + 1 : 1 });
    const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
    const payload = `${p.data.bizNo}.${exp}`;
    const token = `${this.b64u(Buffer.from(payload))}.${this.b64u(this.sign(payload))}`;
    await db.insert(events).values([{ session: p.data.session, screen: "share_create", meta: null }]);
    return { ok: true, token, exp };
  }

  @Get(":token")
  async view(@Param("token") token: string) {
    const parts = (token ?? "").split(".");
    if (parts.length !== 2) return { ok: false, error: "bad_token" };
    let payload: string;
    let sig: Buffer;
    try {
      payload = Buffer.from(parts[0], "base64url").toString();
      sig = Buffer.from(parts[1], "base64url");
    } catch { return { ok: false, error: "bad_token" }; }
    const expect = this.sign(payload);
    if (sig.length !== expect.length || !timingSafeEqual(sig, expect))
      return { ok: false, error: "bad_signature" };
    const [bizNo, expStr] = payload.split(".");
    if (!/^\d{10}$/.test(bizNo ?? "") || Number(expStr) < Date.now() / 1000)
      return { ok: false, error: "expired" };
    const [f] = await db.select().from(firms).where(eq(firms.bizNo, bizNo)).limit(1);
    const rows = await db.select({
      won: firmBids.won, bidRate: firmBids.bidRate, winRate: firmBids.winRate,
      openedAt: firmBids.openedAt, schoolName: firmBids.schoolName,
      sigungu: firmBids.sigungu, basePrice: firmBids.basePrice,
    }).from(firmBids).where(eq(firmBids.bizNo, bizNo));
    const lost = rows.filter(r => !r.won);
    const below = lost.filter(r => r.bidRate != null && r.winRate != null && r.bidRate < r.winRate).length;
    const recentWins = rows.filter(r => r.won)
      .sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? "")).slice(0, 5)
      .map(r => ({ openedAt: r.openedAt, schoolName: r.schoolName, sigungu: r.sigungu,
        basePrice: r.basePrice, bidRate: r.bidRate }));
    return {
      ok: true, name: f?.name ?? null,
      totals: { part: rows.length, wins: rows.length - lost.length,
        pushed: lost.length - below, below },
      recentWins,
    };
  }
}

@Controller("events")
class EventsController {
  /** 화면 열람 배치 수신 — 게이트 측정. 개인정보 없음(익명 세션 키만) */
  @Post()
  async ingest(@Body() body: unknown) {
    const Row = z.object({
      session: z.string().min(1).max(64),
      screen: z.string().min(1).max(40),
      meta: z.record(z.string(), z.unknown()).optional(),
    });
    const Batch = z.object({ rows: z.array(Row).min(1).max(50) });
    const parsed = Batch.safeParse(body);
    if (!parsed.success) return { ok: false };
    await db.insert(events).values(parsed.data.rows.map(r => ({
      session: r.session, screen: r.screen, meta: r.meta ?? null,
    })));
    return { ok: true, n: parsed.data.rows.length };
  }

  /** 화면별·일별 열람 수 (최근 30일) */
  @Get("summary")
  async summary() {
    const rows = await db.select({
      day: sql<string>`to_char(ts, 'YYYY-MM-DD')`,
      screen: events.screen,
      n: sql<number>`count(*)`,
      sessions: sql<number>`count(distinct session)`,
    }).from(events)
      .where(sql`ts >= now() - interval '30 days'`)
      .groupBy(sql`to_char(ts, 'YYYY-MM-DD')`, events.screen)
      .orderBy(sql`to_char(ts, 'YYYY-MM-DD') desc`);
    return rows.map(r => ({ day: r.day, screen: r.screen, n: Number(r.n), sessions: Number(r.sessions) }));
  }
}

@Controller()
class HealthController {
  @Get("healthz")
  health() { return { ok: true, ts: new Date().toISOString() }; }
}

@Module({
  controllers: [HealthController, AuthController, MeController, ShareController, EventsController, RoundsController, WinsController, SchoolsController, OpenController, MarketController, FirmsController, ResultsController],
})
export class AppModule {}
