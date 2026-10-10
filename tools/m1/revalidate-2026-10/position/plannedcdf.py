"""모듈 책임: 2025년까지 하한율 90 회차의 예정가격 ÷ 기초금액 누적분포를 0.0001 간격 매듭의 백만분율 정수로 내고, 서버의 선언형 표 모듈을 인자 경로에 쓴다(최근 3개월 맞춤의 추첨 분포)."""
import io
import sys

import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
z = np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz", allow_pickle=True)
cnt = z["off"]; R = z["R"]; Rs = z["R_suspect"]; floor = z["floor"]; ym = z["ym"]
nat = np.where((~Rs) & (floor == 90.0) & (cnt >= 2) & (ym <= 202512))[0]
Rn = np.sort(R[nat])
# 예비가격이 기초금액 ±3% 안에서 뽑히므로 0.9690~1.0310이면 관측 전부를 덮는다(관측 범위 0.9718~1.0270).
FIRST, LAST = 9690, 10310
knots = np.arange(FIRST, LAST + 1) / 10000
ppm = np.round(np.searchsorted(Rn, knots, side="right") / len(Rn) * 1e6).astype(int)
assert ppm[0] == 0 and ppm[-1] == 1_000_000 and np.all(np.diff(ppm) >= 0)
print(f"표본 {len(Rn)} · 범위 {Rn[0]:.6f}~{Rn[-1]:.6f} · 매듭 {len(knots)}")

lines = []
for start in range(0, len(ppm), 12):
    lines.append("    " + ", ".join(str(int(v)) for v in ppm[start:start + 12]) + ",")
body = "\n".join(lines)
module = f'''/**
 * @module 책임: 최근 3개월 맞춤이 쓰는 예정가격 추첨 분포(예정가격 ÷ 기초금액의 누적분포)를 선언형 표로 소유한다.
 *
 * 손으로 고치지 않는다. `tools/m1/revalidate-2026-10/position/plannedcdf.py`가 2025년까지 하한율 90 회차
 * {len(Rn)}건으로 낸 값이다. 추첨 장치(예비가격 15개 중 많이 뽑힌 4개 평균)는 지역과 상관없이 같아서 전국 분포를 쓴다 —
 * 김해 시장의 10·50·90 분위가 전국과 0.0006 안에서 같았다(실험 기록 §14).
 */
import type {{ PlannedRatioDistribution }} from "./market-position-pick";

export const PLANNED_RATIO_DISTRIBUTION = {{
  version: "2026-10-10",
  sourceRounds: {len(Rn)},
  firstKnotTenThousandths: {FIRST},
  lastKnotTenThousandths: {LAST},
  // 매듭 k(= firstKnot + k, 단위 0.0001)까지의 누적 비율을 백만분율 정수로 둔다. 매듭 사이는 선형으로 잇는다.
  cumulativePartsPerMillion: [
{body}
  ],
}} as const satisfies PlannedRatioDistribution;
'''
with open(sys.argv[1], "w", encoding="utf-8", newline="\n") as f:
    f.write(module)
print("썼다:", sys.argv[1])
