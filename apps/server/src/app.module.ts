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

  @Get(":id/auctions")
  async auctions(@Param("id") id: string) {
    return db.select().from(schoolAuctions)
      .where(eq(schoolAuctions.schoolId, id))
      .orderBy(schoolAuctions.openedAt);
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
      }));
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
  controllers: [HealthController, SchoolsController, OpenController, MarketController, FirmsController],
})
export class AppModule {}
