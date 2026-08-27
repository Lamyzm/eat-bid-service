import { Module, Controller, Get, Query, Param } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { eq, ilike, and, desc, inArray } from "drizzle-orm";
import {
  SchoolsQuery, OpenQuery, schools, schoolAuctions, openAuctions, marketRegions, firmBids, firms,
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
      schoolId: schoolAuctions.schoolId, openedAt: schoolAuctions.openedAt,
    }).from(schoolAuctions).orderBy(schoolAuctions.schoolId, schoolAuctions.openedAt);
    const bySchool = new Map<string, string[]>();
    for (const r of rows) {
      if (sigungu && !r.schoolId.startsWith(sigungu)) continue;
      const l = bySchool.get(r.schoolId) ?? [];
      l.push(r.openedAt); bySchool.set(r.schoolId, l);
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
        medGapDays: medGap, expected: expected.toISOString().slice(0, 10), dueInDays });
    }
    return out.sort((a, b) => a.dueInDays - b.dueInDays);
  }

  @Get(":id/auctions")
  async auctions(@Param("id") id: string) {
    return db.select().from(schoolAuctions)
      .where(eq(schoolAuctions.schoolId, id))
      .orderBy(schoolAuctions.openedAt);
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
  @Get()
  async list(@Query() q: OpenQueryDto) {
    const rows = await db.select().from(openAuctions);
    return rows
      .filter(r => !q.region || (r.sigungu ?? "").includes(q.region)
        || (r.allowedRegions ?? []).some(a => a.includes(q.region!)))
      .filter(r => !q.category || r.category === q.category)
      .map(r => ({
        ...r,
        anchorAmount: r.basePrice && r.floorRate
          ? Math.round(r.basePrice * r.floorRate / 100) : null,
        schoolId: r.sigungu && r.schoolName ? `${r.sigungu}|${r.schoolName}` : null,
      }));
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

  /** 사업자번호 확인(온보딩): 존재 여부 + 이름 */
  @Get("lookup")
  async lookup(@Query("bizNo") bizNo: string) {
    const bz = (bizNo ?? "").replace(/-/g, "").trim();
    const [f] = await db.select().from(firms).where(eq(firms.bizNo, bz)).limit(1);
    return f ? { found: true, bizNo: f.bizNo, name: f.name, totalBids: f.totalBids, totalWins: f.totalWins }
             : { found: false, bizNo: bz };
  }
}

@Controller()
class HealthController {
  @Get("healthz")
  health() { return { ok: true, ts: new Date().toISOString() }; }
}

@Module({
  controllers: [HealthController, SchoolsController, OpenController, MarketController, FirmsController, ResultsController],
})
export class AppModule {}
