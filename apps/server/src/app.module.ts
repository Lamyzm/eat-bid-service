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
  /** 성적표 — 사업자번호 콤마목록(워크스페이스 합산) */
  @Get("record")
  async record(@Query("bizNos") bizNosCsv: string) {
    const bizNos = (bizNosCsv ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (!bizNos.length) return { bizNos: [], totalBids: 0, totalWins: 0, pushedOut: 0, belowFloor: 0, regions: [] };
    const rows = await db.select().from(firmBids)
      .where(inArray(firmBids.bizNo, bizNos));
    const fs = await db.select().from(firms).where(inArray(firms.bizNo, bizNos));
    return {
      bizNos,
      totalBids: rows.length,
      totalWins: rows.filter(r => r.won).length,
      pushedOut: 0,   // TODO: 적재 시 하한 대비 분해 반영
      belowFloor: 0,
      regions: [...new Set(fs.flatMap(f => f.regions ?? []))],
    };
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
