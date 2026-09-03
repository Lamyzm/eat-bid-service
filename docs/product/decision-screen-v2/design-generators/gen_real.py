"""모듈 책임: 실제 학교(창원 남산초) 회차를 합본 생성기에 넣어 설계가 실데이터에서 버티는지 본다.

지어낸 회차로 정한 축 범위·표 길이·예행 결과가 실제에서 뒤집히는지가 이 파일의 목적이다.
"""

from __future__ import annotations

import io
import json
import sys

sys.path.insert(
    0,
    r"C:\Users\kano\AppData\Local\Temp\claude\F--Project-eat-bid-service"
    r"\969c0791-3647-4b2d-bec4-3b3a916a7f12\scratchpad",
)

import gen_axis as axis_mod
import gen_merged as merged
import gen_timeline as time_mod

SRC = (
    r"C:\Users\kano\AppData\Local\Temp\claude\F--Project-eat-bid-service"
    r"\969c0791-3647-4b2d-bec4-3b3a916a7f12\scratchpad\namsan.json"
)


def firm_board(picked: list[dict]) -> None:
    """실제 명단(bids[])으로 업체 표와 겹침 수열을 만들어 업체 탭 보드를 그린다."""
    detail = json.load(io.open(SRC.replace("namsan.json", "namsan_rounds.json"), encoding="utf-8"))
    index_of = {r["bidId"]: i for i, r in enumerate(picked)}
    rounds = [d for d in detail if d["bidId"] in index_of]
    per_firm: dict[str, dict] = {}
    for d in rounds:
        i = index_of[d["bidId"]]
        ranked = sorted((b for b in d["bids"] if b["rate"] is not None), key=lambda b: b["rate"])
        for rank, b in enumerate(ranked):
            f = per_firm.setdefault(b["biz"], {"name": b["name"], "series": [], "seats": [], "wins": 0})
            invalid = b["status"] == "하한미달"
            f["series"].append((i, float(b["rate"]), invalid))
            f["seats"].append(rank / max(len(ranked) - 1, 1) * 100)
            f["wins"] += 1 if b["status"] == "낙찰" else 0
    # 참여 수 동률이 많다(9회 32곳). 낙찰이 있는 업체를 먼저, 그다음 이름순.
    top = sorted(per_firm.values(), key=lambda f: (-len(f["series"]), -f["wins"], f["name"]))[:12]
    merged.FIRM_ROWS[:] = [
        (f["name"], len(f["series"]), f["wins"],
         sorted(v for _i, v, _inv in f["series"])[len(f["series"]) // 2],
         int(sorted(f["seats"])[len(f["seats"]) // 2]))
        for f in top
    ]
    merged.FIRM_SERIES.clear()
    merged.FIRM_SERIES.update({k: sorted(f["series"]) for k, f in enumerate(top)})
    merged.FIRM_SELECTED = 0
    with io.open("Real1440Firm.dc.html", "w", encoding="utf-8", newline="") as handle:
        handle.write(merged.detail(1440, "open", "업체"))
    merged.FIRM_SELECTED = None
    every = sum(1 for f in per_firm.values() if len(f["series"]) == len(rounds))
    print(
        f"명단 {len(rounds)}회차 · 업체 {len(per_firm)}곳 · 전 회차 참여 {every}곳"
        f" · 1위 {top[0]['name']} {len(top[0]['series'])}회 낙찰 {top[0]['wins']}"
    )


def main() -> int:
    rows = json.load(io.open(SRC, encoding="utf-8"))
    picked = sorted(
        (r for r in rows if r.get("floorRate") == 90 and r.get("winRate") and r.get("secondRate")),
        key=lambda r: r["openedAt"],
    )[-20:]
    # (개찰 월, 명단, 무효, 낙찰률, 2등가, 관측된 탈락선)
    real = [
        (r["openedAt"][2:7], int(r["nBids"]), int(r["nBids"]) - int(r["nValid"]),
         float(r["winRate"]), float(r["secondRate"]),
         float(r["maxInvalid"]) if r.get("maxInvalid") is not None else None)
        for r in picked
    ]
    axis_mod.ROUNDS[:] = real
    time_mod.ROUNDS = axis_mod.ROUNDS
    merged.ROUNDS = axis_mod.ROUNDS
    axis_mod.SELECTED = len(real) - 1
    axis_mod.CATEGORIES[:] = [r["category"] for r in picked]
    axis_mod.CATEGORY = "축산"
    merged.SCHOOL.update(name="남산초등학교", region="경상남도 창원시", chip="경상남도 · 창원시")
    merged.RAIL_EXPANDED = True
    time_mod.SHOW_OTHER = True   # 실데이터 보드는 다른 품목 점을 켠 상태를 보인다
    winners = [r["winnerBiz"] for r in rows if r.get("winnerBiz")]
    streak = sum(1 for a, b in zip(winners, winners[1:]) if a == b)
    merged.FIRM_NOTE = f"지난 {len(winners)}회 낙찰 {len(set(winners))}곳 · 연속 낙찰 {streak}회"
    sizes_sorted = sorted(n for _m, n, *_ in real)
    usual = sizes_sorted[len(sizes_sorted) // 2]
    dates = sorted(r["openedAt"] for r in picked)
    from datetime import date
    gaps = [
        (date.fromisoformat(b) - date.fromisoformat(a)).days
        for a, b in zip(dates, dates[1:]) if b != a
    ]
    cycle = sorted(gaps)[len(gaps) // 2] if gaps else 0
    last = date.fromisoformat(dates[-1])
    merged.CYCLE.update(
        days=cycle, last=dates[-1][5:10], since=(date(2026, 9, 3) - last).days
    )
    page = merged.detail(1440, "open")
    with io.open("Real1440.dc.html", "w", encoding="utf-8", newline="") as handle:
        handle.write(page)
    firm_board(picked)
    sizes = [n for _m, n, *_ in real]
    invalid = [i for _m, _n, i, *_ in real]
    wins = [w for _m, _n, _i, w, *_ in real]
    print(
        f"실데이터 {len(real)}회 · 명단 {min(sizes)}~{max(sizes)} · 무효 {min(invalid)}~{max(invalid)}"
        f" · 낙찰률 {min(wins):.3f}~{max(wins):.3f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
