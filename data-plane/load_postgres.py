# -*- coding: utf-8 -*-
"""레이크·집계 산출물 → 서빙 Postgres 적재.

계약: packages/shared/src/db/schema/index.ts 의 drizzle DDL이 진실.
소스: F:/Project/eat-bid 의 parquet 레이크 + data/bidboard/*.json 산출물.
"""
import sys, os, json, datetime
import psycopg

EATBID = os.environ.get("EATBID_HOME", r"F:\Project\eat-bid")
DB_URL = os.environ.get("DATABASE_URL", "postgres://eatbid:eatbid@localhost:5434/eatbid")
sys.path.insert(0, os.path.join(EATBID, "src"))
from pathlib import Path
from eatbid.lake import connect  # noqa: E402

def d8(s):
    return datetime.date(int(s[:4]), int(s[4:6]), int(s[6:8])) if s and len(s) >= 8 else None

def main():
    duck = connect(Path(EATBID) / "data" / "parquet")
    pg = psycopg.connect(DB_URL)
    cur = pg.cursor()

    # ---- schools + school_auctions (김해 축산 — MVP 범위) ----
    aj = json.load(open(os.path.join(EATBID, "data", "bidboard", "all_schools.json"), encoding="utf-8"))
    cur.execute("delete from school_auctions"); cur.execute("delete from schools")
    for s in aj["schools"]:
        sid = f"김해시|{s['school']}"
        cur.execute(
            """insert into schools (id,name,sido,sigungu,category,n_auctions,med_field,med_base,rsd,by_floor)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (sid, s["school"], "경상남도", "김해시", "축산", s["n"], s["medfield"],
             s.get("medbase"), s.get("Rsd"), json.dumps(s["byfloor"], ensure_ascii=False)))
    # school_auctions는 레이크에서 실제 bid_id로
    rows = duck.execute("""
        select a.bid_id, a.institution, a.opened_at, a.floor_rate, a.base_price,
               max(b.bid_rate) filter(where b.won) win_rate,
               count(*) filter(where b."valid") nvalid,
               max(b.biz_no) filter(where b.won) winner
        from auctions a join bids b on b.bid_id=a.bid_id
        where a.sigungu like '김해%' and a.institution is not null and length(a.opened_at)>=8
        group by 1,2,3,4,5""").fetchall()
    known = {s["school"] for s in aj["schools"]}
    for bid, inst, op, fl, bp, wr, nv, winner in rows:
        if inst not in known:
            continue
        cur.execute(
            """insert into school_auctions (bid_id,school_id,opened_at,floor_rate,base_price,win_rate,n_valid,winner_biz_no)
               values (%s,%s,%s,%s,%s,%s,%s,%s) on conflict (bid_id) do nothing""",
            (bid, f"김해시|{inst}", d8(op), fl, bp, wr, nv, winner))

    # ---- open_auctions ----
    try:
        oj = json.load(open(os.path.join(EATBID, "data", "bidboard", "open_auctions.json"), encoding="utf-8"))
    except Exception:
        oj = []
    cur.execute("delete from open_auctions")
    for o in oj:
        dl = o.get("opened_at")
        dts = (datetime.datetime.strptime(dl[:12], "%Y%m%d%H%M") if dl and len(dl) >= 12 else None)
        cur.execute(
            """insert into open_auctions (bid_no,school_name,sigungu,allowed_regions,base_price,floor_rate,category,deadline)
               values (%s,%s,%s,%s,%s,%s,%s,%s)""",
            (o["bid_no"], o.get("school"), o.get("sgg"), json.dumps([o.get("sgg") or ""], ensure_ascii=False),
             o.get("base"), o.get("floor"), "축산", dts))

    # ---- market_regions ----
    mj = json.load(open(os.path.join(EATBID, "data", "bidboard", "market_map.json"), encoding="utf-8"))
    cur.execute("delete from market_regions")
    for r in mj["rows"]:
        cur.execute(
            """insert into market_regions (sido,sigungu,category,per_year,med_field,exp_win,med_base,market_yr,top5_share,detail)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (sigungu,category) do update set exp_win=excluded.exp_win""",
            (r["sido"], r["sgg"], "축산", r["peryear"], r["medf"], r["expwin"],
             r.get("medbase"), r.get("marketyr"), r.get("top5share"),
             json.dumps({k: r[k] for k in ("topwinners", "ytrend", "mons", "schools") if k in r}, ensure_ascii=False)))

    # ---- firms (전체 요약) + firm_bids (우리 2개 — MVP) ----
    cur.execute("delete from firm_bids"); cur.execute("delete from firms")
    for bz, nm, regions, fs, ls, n, w in duck.execute("""
        select b.biz_no, max(b.company), list(distinct a.sigungu),
               min(a.opened_at), max(a.opened_at), count(*), count(*) filter(where b.won)
        from bids b join auctions a on a.bid_id=b.bid_id
        where b.biz_no is not null and a.sigungu is not null
        group by 1 having count(*)>=10""").fetchall():
        cur.execute(
            """insert into firms (biz_no,name,regions,first_seen,last_seen,total_bids,total_wins)
               values (%s,%s,%s,%s,%s,%s,%s)""",
            (bz, nm or bz, json.dumps([r for r in regions if r], ensure_ascii=False), d8(fs), d8(ls), n, w))
    for bid, bz, rate, won in duck.execute("""
        select bid_id, biz_no, bid_rate, cast(won as int) from bids
        where biz_no in ('7175001228','3118152843')""").fetchall():
        cur.execute(
            """insert into firm_bids (bid_id,biz_no,bid_rate,won) values (%s,%s,%s,%s)
               on conflict do nothing""", (bid, bz, rate, won))

    pg.commit()
    for t in ("schools", "school_auctions", "open_auctions", "market_regions", "firms", "firm_bids"):
        cur.execute(f"select count(*) from {t}")
        print(f"  {t}: {cur.fetchone()[0]}")
    pg.close()

if __name__ == "__main__":
    main()
