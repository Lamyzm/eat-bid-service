import { describe, expect, test } from "bun:test";
import { baseRelativeBidRate, bidRate, canonicalDecimal, krw, Temporal } from "@eatbid/domain";

import { EffectRunner } from "../../../platform/effect/effect-runner";
import { kstDate } from "../domain/kst-day";
import { toFloorLineRegionsResponse, toFloorLinesResponse } from "../presentation/http/floor-lines.presenter";
import { AnalysisRegionNotFound, type AnalysisAxisLookup } from "./analysis-axes";
import type { FloorLineReader, FloorLineWindow } from "./floor-line-reader";
import { FindFloorLineRegions, FindFloorLines, type FindFloorLinesInput } from "./find-floor-lines";

const 하한율 = bidRate(canonicalDecimal("90.000", 3));
const 기본입력: FindFloorLinesInput = {
  sigunguCodeValueId: 459n,
  period: { from: kstDate("2025-10-01"), to: kstDate("2026-09-30") },
  floorRate: 하한율,
  includeLadders: false,
};
const 비율 = (text: string) => baseRelativeBidRate(canonicalDecimal(text, 4));

function 읽기(calls: { ladders: number; windows: FloorLineWindow[] }): FloorLineReader {
  return {
    activeLineage: async () => null,
    regionLabel: async () => "김해시",
    readPoints: async (window) => {
      calls.windows.push(window);
      return [{
        attemptId: 11n,
        revisionId: 12n,
        openedAt: Temporal.Instant.from("2026-09-28T02:00:00Z"),
        organizationName: "가상초등학교",
        baseAmount: krw(canonicalDecimal("9386500.00", 2)),
        floor: 비율("89.4437"),
      }];
    },
    readLadders: async () => {
      calls.ladders += 1;
      return [{ attemptId: 11n, validBidderCount: 53, lowest: [비율("89.4446"), 비율("89.7800")] }];
    },
    readRegions: async () => [
      { sidoCodeValueId: 2n, sidoLabel: "경남", sigunguCodeValueId: 459n, sigunguLabel: "김해시", pointCount: 5785 },
      { sidoCodeValueId: 2n, sidoLabel: "경남", sigunguCodeValueId: 460n, sigunguLabel: "거제시", pointCount: 900 },
      { sidoCodeValueId: 1n, sidoLabel: "경기", sigunguCodeValueId: 10n, sigunguLabel: null, pointCount: 3 },
    ],
  };
}

const 지역있음: AnalysisAxisLookup = { organizationExists: async () => true, regionExists: async () => true };
const runner = new EffectRunner();

describe("하한선 자리 use case", () => {
  test("기간은 KST 하루 시작부터 끝 다음 날 0시까지이고 하한율은 milli로 넘긴다", async () => {
    const calls = { ladders: 0, windows: [] as FloorLineWindow[] };
    await runner.run(new FindFloorLines(읽기(calls), 지역있음).execute(기본입력));
    expect(calls.windows[0]!.from.toString()).toBe("2025-09-30T15:00:00Z");
    expect(calls.windows[0]!.before.toString()).toBe("2026-09-30T15:00:00Z");
    expect(calls.windows[0]!.floorRateMilli).toBe(90_000n);
  });

  test("1~10등 사다리는 청했을 때만 읽고, 청하지 않으면 빈 배열이 아니라 null이다", async () => {
    const calls = { ladders: 0, windows: [] as FloorLineWindow[] };
    const 안청함 = await runner.run(new FindFloorLines(읽기(calls), 지역있음).execute(기본입력));
    expect(안청함.ladders).toBeNull();
    expect(calls.ladders).toBe(0);
    const 청함 = await runner.run(new FindFloorLines(읽기(calls), 지역있음).execute({ ...기본입력, includeLadders: true }));
    expect(청함.ladders).toHaveLength(1);
    expect(calls.ladders).toBe(1);
  });

  test("하한선 분포는 맞춤·복기와 같은 예정가격 추첨 분포 판을 하한율로 바꿔 싣는다", async () => {
    const result = await runner.run(new FindFloorLines(읽기({ ladders: 0, windows: [] }), 지역있음).execute(기본입력));
    expect(result.rule.version).toBe("2026-10-10");
    expect(result.rule.sourceRounds).toBe(108126);
    expect(result.rule.quantiles).toHaveLength(199);
    expect(Number(result.rule.quantiles[99]!)).toBeCloseTo(89.91, 1);
  });

  test("없는 시군구는 빈 점이 아니라 지역 없음으로 실패한다", async () => {
    const 없음: AnalysisAxisLookup = { organizationExists: async () => true, regionExists: async () => false };
    const outcome = runner.run(new FindFloorLines(읽기({ ladders: 0, windows: [] }), 없음).execute(기본입력));
    await expect(outcome).rejects.toBeInstanceOf(AnalysisRegionNotFound);
  });

  test("응답은 단위와 분모를 목록에 한 번 두고 점 수를 meta에 싣는다", async () => {
    const result = await runner.run(new FindFloorLines(읽기({ ladders: 0, windows: [] }), 지역있음)
      .execute({ ...기본입력, includeLadders: true }));
    const wire = toFloorLinesResponse(result);
    expect(wire.points[0]!.floor).toEqual({ value: "89.4437", unit: "percentage-points" });
    expect(wire.points[0]!.baseAmount).toEqual({ amount: "9386500.00", currency: "KRW" });
    expect(wire.ladders![0]!.lowest).toEqual({ unit: "percentage-points", denominator: "base-amount", values: ["89.4446", "89.7800"] });
    expect(wire.meta.pointCount).toBe(1);
    expect(wire.meta.region).toEqual({ codeValueId: "459", label: "김해시" });
  });

  test("지역 목록은 시도마다 묶고 이름 순으로 세우며 이름 없는 구역도 빼지 않는다", async () => {
    const result = await runner.run(new FindFloorLineRegions(읽기({ ladders: 0, windows: [] }))
      .execute({ period: 기본입력.period, floorRate: 하한율 }));
    const wire = toFloorLineRegionsResponse(result);
    expect(wire.groups.map((group) => group.sido.label)).toEqual(["경기", "경남"]);
    expect(wire.groups[1]!.sigungu.map((item) => item.region.label)).toEqual(["거제시", "김해시"]);
    expect(wire.groups[0]!.sigungu[0]).toEqual({ region: { codeValueId: "10", label: null }, pointCount: 3 });
  });
});
