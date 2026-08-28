# PATCH-WIRING — 레이크에 있는데 서빙이 안 읽는 값 배선 (초안)

**2026-08-28 · audit-pipeline · 실행·커밋 안 함. 8/30 적용 대상.**
기준 커밋 `b936a99`(로더 `a[15]` 수정 + `COL` 이름표).

---

## 0. 지시 대비 변경 — 실측이 셋을 바꿨다

| 지시 | 실측 | 이 패치 |
|---|---|---|
| `areas[].sgg_cd` 로 자격 판정 | `(ctpv_cd,sgg_cd)` 쌍 **33개** vs `pdlc_nm` **283종**, 한 코드에 이름 여럿 **16/33** | ❌ 제외. **`pdlc_nm` 으로 대체** (승인 완료) |
| `bids.rank`·`bid_at` 배선 | 28.2% · 49.8%(`draw_numbers` 51.07%) | ❌ 제외 (승인 완료) |
| **`clean_regions` 의 실존 교집합 수정** | **지금 아무것도 안 지운다 — 0건** | ⚠️ **지시 정정. 아래 §0-1** |

### 0-1. `clean_regions` 는 지금 고칠 것이 없다 — 고칠 자리는 내가 새로 만들 뻔한 곳이다

```
firms.regions 원소 81,297
  → _SGG_RE 형식통과      70,367   (지워진 10,930: 급식실 2,617 · 식생활관 634 · 급식소 510 · '7월' 464 …)
  → 실존교집합 통과        70,367   ★ 추가로 지워진 것 0건
```

**교집합이 no-op 이다.** `firms.regions` 원소는 `auctions.sigungu` 에서 나오고 `real_sggs` 도 같은 출처라 **구조적으로 부분집합**이다. 지우는 일은 형식 정규식이 전부 한다.

**진짜 위험은 내가 제안한 `pdlc_nm` 경로다.** 거기에 같은 교집합을 복사하면:

```
pdlc 자격지역 형식통과 223,657 → 실존교집합 적용 시 221,846  (지워짐 1,811)
   고성군 1,056 · 장흥군 203 · 진도군 182 · 남해군 99 · 임실군 96 · 창녕군 81 · 진안군 59 …
```

**이 지역들은 자격은 주는데 학교 발주가 없는 곳이다.** 자격 지역과 발주 지역은 다른 집합인데 교집합을 걸면 **"낼 수 있는데 목록에 없는 지역"**이 생긴다. → **`pdlc_nm` 경로에는 형식 검사만 걸고 교집합을 걸지 않는다.** `clean_regions` 는 손대지 않는다.

---

## 1. `schema.sql` 추가 블록 — 파일 끝에 그대로 붙인다

**전부 `ADD COLUMN IF NOT EXISTS`. 기존 컬럼·PK·`schools.id` 형식 불변.**

```sql
-- ─── 레이크 배선 (2026-08-30) — 추가만. 기존 컬럼은 건드리지 않는다. ───
-- 근거: docs/AUDIT-PIPELINE.md §1-A · docs/PATCH-WIRING.md

-- 학교 정체성: purr_cd 는 이미 있다(0/4,700 — 로더가 죽어서 못 채웠다).
-- n_purr_cd 는 A-9(한 school_id 에 기관코드 여럿)를 화면이 스스로 말하게 하는 재료.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS "sido_cd"      varchar(8);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS "n_purr_cd"    integer;
-- 참여 업체 수: 기존 med_field(유효 투찰 중앙값)는 그대로 두고 총 투찰 기준을 옆에 싣는다.
-- 화면이 "참여 곳"이라 부르는 값의 진짜 대응물(원본 BID_CNT == ds_bidList 행수, 표본 500/500).
ALTER TABLE schools ADD COLUMN IF NOT EXISTS "med_field_all" integer;

ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "purr_cd"              varchar(32);
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "sido_cd"              varchar(8);
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "n_bids"               integer;
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "n_below_floor"        integer;
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "qualification_review" boolean;
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "allowed_regions"      jsonb;
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "allowed_basis"        varchar(20);

-- firm_bids: 학교명 단독 조인이 서로 다른 두 학교를 합친다(AUDIT-SERVE 7-3).
-- school_id 를 같이 실어 조인 키를 학교로 만든다. school_name 은 표시용으로 남긴다.
ALTER TABLE firm_bids ADD COLUMN IF NOT EXISTS "school_id"  varchar(200);
CREATE INDEX IF NOT EXISTS idx_firm_bids_school_id ON firm_bids (school_id);

ALTER TABLE open_auctions ADD COLUMN IF NOT EXISTS "sido"          varchar(40);
ALTER TABLE open_auctions ADD COLUMN IF NOT EXISTS "sido_cd"       varchar(8);
ALTER TABLE open_auctions ADD COLUMN IF NOT EXISTS "allowed_basis" varchar(20);
```

**`bid_amount`(X33)는 넣지 않았다** — `firm_bids` 가 790만행 COPY라 컬럼 추가가 적재 시간에 직접 얹히고, 원인(단가×수량 반올림 vs 부가세)이 아직 안 갈렸다. **재파싱 회차에 함께 넣는 것을 권한다.**

**`limit_condition_cd` 는 승인 대상이다** — 원래 지시 목록에 없었다. `allowed_basis` 가 이 값에서 나오므로 **넣지 않으면 `allowed_basis` 도 못 만든다.** 근거는 §3-⑤.

> **새 개념이 아니다 — 선례가 이미 코드에 있다.** `app.module.ts:229` 의 `qualificationBasis: "region-only"` 와 그 주석(*"화면은 '자격 충족'이 아니라 '지역 자격 충족'이라고 말해야 한다"*)이 정확히 같은 형태다. **값 옆에 근거를 실어 화면이 단언하지 못하게 하는 규약**을 한 칸 더 적용하는 것이다. `limit_condition_cd` 는 레이크에 100% 있으므로 재파싱도 불필요하다.
>
> **넣지 않으면 무엇이 남는가:** `areas` 빈 5,064회차 중 **566건은 원본이 `QLFC_LMT_YN='Y'` 로 "자격 제한 있음"이라 명시**하는데, 화면은 계속 "지역 제한 없음"이라 단언한다. 헌법 4번(모르면 모른다고 한다)의 정면 위반이고, **우리 규칙이 헐거운 게 아니라 원본이 반대로 말하는데 무시하는 것**이라 A-12(부분문자열 과잉포함)보다 나쁘다.

---

## 2. `load_postgres.py` 패치

### 2-1. 회차 원장 — 컬럼 4개를 **끝에** 붙인다 (기존 인덱스 불변)

```diff
     rows = duck.execute("""
         select a.sido, a.sigungu, a.institution, a.bid_id, a.opened_at, a.floor_rate,
                a.base_price, a.bid_name, a.planned_price,
                max(b.bid_rate) filter(where b.won) win_rate,
                count(*) filter(where b."valid") nvalid,
                max(b.biz_no) filter(where b.won) winner,
-               a.main_item, a.item_class, a.institution_code
+               a.main_item, a.item_class, a.institution_code,
+               a.sido_code, a.is_qualification_review, a.limit_condition_cd,
+               count(*) n_bids
         from auctions a join bids b on b.bid_id=a.bid_id
         where a.sigungu is not null and a.institution is not null and length(a.opened_at)>=8
-        group by 1,2,3,4,5,6,7,8,9,13,14,15""").fetchall()
+        group by 1,2,3,4,5,6,7,8,9,13,14,15,16,17,18""").fetchall()

     class COL:
         sido, sigungu, institution, bid_id, opened_at, floor_rate = 0, 1, 2, 3, 4, 5
         base_price, bid_name, planned_price, win_rate, nvalid, winner = 6, 7, 8, 9, 10, 11
-        main_item, item_class, institution_code = 12, 13, 14
+        main_item, item_class, institution_code = 12, 13, 14
+        sido_code, is_qualification_review, limit_condition_cd, n_bids = 15, 16, 17, 18
```

> **`group by` 의 16,17,18 은 1-based select 위치**(= `sido_code`·`is_qualification_review`·`limit_condition_cd`)다. `n_bids` 는 집계라 넣지 않는다. **오늘 `a[15]` 사고가 정확히 이 1-based/0-based 혼동에서 났으므로 §4 테스트가 이걸 검사한다.**

### 2-2. 남은 위치 인덱스를 `COL` 로 바꾼다 — **11종 · 41회 출현**

`b936a99` 는 `institution_code` 한 곳만 이름표로 바꿨다. 나머지가 그대로면 **다음에 컬럼을 앞에 끼우는 순간 같은 사고가 난다.** 전량 치환한다(동작 변화 없음). 실측 출현 횟수:

```
a[6]  → COL.base_price     9회      a[5]  → COL.floor_rate     3회
a[3]  → COL.bid_id         8회      a[7]  → COL.bid_name       1회
a[10] → COL.nvalid         5회      a[12] → COL.main_item      1회
a[9]  → COL.win_rate       4회      a[13] → COL.item_class     1회
a[4]  → COL.opened_at      4회      a[8]  → COL.planned_price  1회
a[11] → COL.winner         4회
```

> `a[0]`·`a[1]`·`a[2]`(sido·sigungu·institution)는 `by_school` 구성에서 이미 언패킹돼 쓰여 대상이 아니다.

> **`a[15]` 는 코드에 없다 — 주석 안에만 남았다.** `b936a99` 의 수정은 완전하고, **다음 크론은 죽지 않는다.** (내 첫 스캔이 주석을 코드로 오인했다. §4 테스트가 주석을 지우고 검사하는 이유다.)

### 2-3. 자격 지역 — `pdlc_nm` 에서. `sgg_cd` 는 쓰지 않는다

`by_school` 구성 **직후**(현 `real_sggs` 정의보다 앞)에 넣는다:

```python
    # 자격 지역 — areas[].pdlc_nm('경남/창원시' 형식, 100% 채움)에서 만든다.
    # sgg_cd 는 쓰지 않는다: (ctpv_cd,sgg_cd) 고유 쌍 33개로 pdlc_nm 283종을
    # 식별하지 못하고, 한 코드에 이름이 여럿인 것이 16/33 이다('185'→52개 이름).
    # 코드처럼 생겼지만 코드가 아니다 — MLFD_CLASS_CD 와 같은 함정.
    #
    # 실존 시군구 교집합을 걸지 않는다. 자격 지역과 발주 지역은 다른 집합이라
    # 교집합을 걸면 고성군(1,056행)·장흥군·진도군처럼 "낼 수 있는데 목록에 없는"
    # 지역이 생긴다. 형식 검사만 건다.
    def _norm_sgg(s):
        t = (s or "").strip()
        if not t or t == "전체":
            return None
        if _SGG_RE.match(t):
            return canon_sgg(t)
        for suf in ("시", "군", "구"):          # '하남'·'성남' 같은 접미사 절단
            if _SGG_RE.match(t + suf):
                return canon_sgg(t + suf)
        return None

    allowed_of = collections.defaultdict(list)
    has_jeonche = set()
    for _bid, _sgg in duck.execute("""
            select a.bid_id, trim(str_split(u.pdlc_nm, '/')[2])
            from auctions a, unnest(a.areas) t(u) where a.areas is not null""").fetchall():
        if (_sgg or "").strip() == "전체":
            has_jeonche.add(_bid)
            continue
        c = _norm_sgg(_sgg)
        if c and c not in allowed_of[_bid]:
            allowed_of[_bid].append(c)
```

`school_auctions` insert 시:

```python
            # 자격 근거를 값과 함께 싣는다. "지역 제한 없음"과 "지역 외 제한 방식"과
            # "우리가 못 읽음"은 서로 다른 사실이다 — 합쳐 부르면 거짓말이 된다.
            _lcc = a[COL.limit_condition_cd]
            if _bid in has_jeonche:
                _al, _basis = [], "unrestricted"        # 원본이 '전체'라고 말했다
            elif allowed_of.get(a[COL.bid_id]):
                _al, _basis = allowed_of[a[COL.bid_id]], "region-list"
            elif _lcc and _lcc != "003":
                _al, _basis = [], "non-region-limit"    # 001/002 = 지역 아닌 제한 방식
            else:
                _al, _basis = [], "unknown"
```

### 2-4. `firm_bids` 에 `school_id` — 학교명 단독 조인을 끝낸다

```diff
     q = duck.execute("""
         with w as (select bid_id, max(bid_rate) filter(where won) win_rate from bids group by 1)
         select b.bid_id, b.biz_no, b.bid_rate, cast(b.won as int),
                a.opened_at, a.floor_rate, w.win_rate, a.base_price, a.sigungu, a.institution
         ...
     with cur.copy("""copy firm_bids
-        (bid_id,biz_no,bid_rate,won,opened_at,floor_rate,win_rate,base_price,sigungu,school_name)
+        (bid_id,biz_no,bid_rate,won,opened_at,floor_rate,win_rate,base_price,sigungu,school_name,school_id)
         from stdin""") as cp:
         ...
             for bid, bz, rate, won, op, fl, wr, bp, sg, inst in batch:
-                cp.write_row((bid, bz, rate, won, d8(op), fl, wr, bp, sg, inst))
+                # school_id 는 schools.id 와 같은 규칙으로 만든다(정제·canon 동일).
+                # 못 만들면 None — 학교명 단독 조인으로 되돌아가지 않는다.
+                _ci = clean_inst(inst)
+                _sid = f"{canon_sgg(sg)}|{_ci}" if (_ci and sg) else None
+                cp.write_row((bid, bz, rate, won, d8(op), fl, wr, bp, sg, inst, _sid))
```

### 2-6. 🔴 `fetch_open.py` 폴백 — **제한 방식이 다른 공고를 소재지 한 곳으로 가둔다**

refactor-critic 이 물은 자리다. **걸린다. 그리고 피해 방향이 내가 앞서 쓴 것과 반대다.**

```python
# fetch_open.py:62,66  (현재)
allowed = [ar.get("sgg_nm") for ar in areas if ar.get("sgg_nm")]
allowed = allowed or ([a.get("sigungu")] if a.get("sigungu") else []),   # ← 폴백
```

**001/002 회차는 `areas` 가 100% 비어 있다**(실측 `001` 2,549/2,549 · `002` 2,552/2,552). 그러니 이 폴백은 **그 회차에 항상 발동한다.**

**결과가 "무제한 통과"가 아니다.** 폴백이 `[소재지]` 를 넣으므로 목록이 비지 않고, 서버 `isUnrestricted` 의 ① 경로(`list.length===0`)는 **`open_auctions` 에서 영원히 발동하지 않는다.** 대신 `eligibleFor` 가 그 한 곳으로 자격을 좁힌다.

> **즉 지역 제한이 아닌 방식으로 낸 공고가, 학교 소재지 업체에게만 보인다.** 레이크 기준 001/002 는 **109개 시군구**에 흩어져 있으므로, 폴백은 그 공고들을 각자 자기 소재지 1곳에 가둔다.
>
> **team-lead 가 본 "라이브 121건 중 빈 목록 0건"이 이것으로 설명된다** — 진짜로 빈 게 없는 게 아니라 **폴백이 덮어서 안 보이는 것**이다. 그래서 566건 문제는 오늘 화면에 안 나타나지만, **대신 다른 해가 나타나고 있다.**

**패치:**

```diff
             areas = a.get("areas") or []
             allowed = [ar.get("sgg_nm") for ar in areas if ar.get("sgg_nm")]
             open_aucs.append(dict(
                 bid_no=bid_no, school=a.get("institution"), sgg=a.get("sigungu"),
                 sido=a.get("sido"),
-                allowed=allowed or ([a.get("sigungu")] if a.get("sigungu") else []),
+                # 폴백을 지운다. areas 가 비는 것은 수집 실패가 아니라 제한 방식이
+                # 지역이 아니라는 뜻이다(limit_condition_cd 001/002, areas 100% 빔).
+                # 소재지를 자격으로 채우면 그 공고가 소재지 업체에게만 보인다.
+                allowed=allowed,
+                limit_condition_cd=a.get("limit_condition_cd"),
                 base=a.get("base_price"), floor=a.get("floor_rate"),
```

**⚠ 폴백 제거는 단독으로 하면 안 된다.** 지금 `allowed=[]` 로 나가면 `isUnrestricted` ① 이 발동해 **전원 통과**로 뒤집힌다 — 가둔 것을 푸는 대신 반대편 거짓말을 하게 된다. **서버의 `allowed_basis` 분기와 같은 배포에 넣어야 한다.**

**못 가른 것:** 라이브 열린 공고 116건 중 `allowed == [소재지]` 인 것이 **6건**인데, 이게 폴백 산물인지 진짜 단일 지역 제한인지 **JSON 만으로는 못 가른다.** 003 회차에서도 `areas` 가 자기 시군구 하나뿐인 경우가 **8,377건(003 중 4.5%)** 실재하기 때문이다. `limit_condition_cd` 를 수집해야 갈린다 — **그게 이 컬럼이 필요한 두 번째 이유다.**

### 2-5. `schools` insert — 3개 추가

```diff
-            """insert into schools (id,name,sido,sigungu,category,n_auctions,med_field,med_base,by_floor,cat_counts,by_cat_floor,purr_cd)
-               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) on conflict (id) do nothing""",
+            """insert into schools (id,name,sido,sigungu,category,n_auctions,med_field,med_base,by_floor,cat_counts,by_cat_floor,purr_cd,sido_cd,n_purr_cd,med_field_all)
+               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) on conflict (id) do nothing""",
```

`med_field` 는 **그대로 둔다**(유효 투찰 중앙값). `med_field_all` 을 옆에 싣는다 — 값을 바꾸면 재적재 후 화면 변화가 **회귀인지 교정인지 구분이 안 된다.** 화면 이관은 별건이다.

`n_purr_cd` = 이 `school_id` 에 묶인 서로 다른 기관코드 수. **1이 정상, 2 이상이면 A-9.**

---

## 3. 각 값이 서버·웹의 무엇을 바꾸나

| 값 | 지금 | 배선 후 | AUDIT-SERVE 연결 |
|---|---|---|---|
| ① `schools.purr_cd`·`n_purr_cd`·`school_auctions.purr_cd` | `purr_cd` **0/4,700**. A-8/A-9 자가진단이 매 적재마다 `0 · 0` 을 출력하고 있었다(값이 없으니 당연히 0) | 진단이 **42 · 4** 를 출력한다. 학교 화면이 `n_purr_cd>1` 일 때 "이 이름에 기관 2곳이 묶여 있습니다"를 말할 수 있다 | 7-3 (동명이교) |
| ② `sido_cd` | `schools.sido` 문자열 **34종**(정답 17), 빈 값 23 | 코드 **15종**으로 확정. `_SIDO_MAP` 34줄은 **아직 지우지 않는다**(표시명은 계속 문자열에서 온다) | — |
| ③ `n_bids`·`n_below_floor` | 화면이 `n_valid` 를 **"참여 곳"**이라 부른다. `analysis-board` 만 `nBids ?? nValid` 로 총 투찰을 쓴다 → **화면마다 다른 수** | 전 화면이 같은 `n_bids` 를 쓸 수 있다. `n_below_floor` 는 **"하한 아래 관찰"**이며 **"무효"라 부르지 않는다** | 3 (다른 소스) |
| ④ `qualification_review` | 적격심사 1,789회차가 `med_field`·`market_regions`·`cat_counts`·`n_auctions` 에 섞임. `by_floor` 는 하한율이 키라 **이미 갈려 있다** | 회차 표기 분리. **집계에서 빼지 않는다** — 빼면 "왜 합계가 줄었나"가 재적재 회귀와 구분이 안 된다 | — |
| ⑤ `allowed_regions`·`allowed_basis` | 개찰된 회차의 지역 제한을 **모른다**. `open_auctions` 만 안다 | 과거 회차의 응찰 가능 모집단이 생긴다. **`basis` 4값**으로 `unrestricted`(원본이 '전체' — **사실**, 93,418)와 `non-region-limit`(001/002)과 `unknown`을 가른다 | 7-1 · **§2-6** |
| ⑥ `firm_bids.school_id` | `my-bids`·`badges` 가 학교명 단독 조인. 괄호 포함 **16,285행이 영원히 매칭 실패** | 학교 단위로 정확히 조인. `school_name` 은 표시용으로 남는다 | **7-3** |
| ⑦ `open_auctions.sido`·`sido_cd` | 수집기가 `sido` 를 모으는데 **DDL에 컬럼이 없어 버린다**. `enrich` 가 `${sigungu}\|${schoolName}` 로 재조립 → 광역시 동명 구 충돌 | 시도를 실어 충돌을 없앨 재료가 생긴다 | 7-1 |

**⑤ 순서 제약(team-lead 지시대로 유지):** `allowed_regions` **적재가 먼저**, 웹 `?region=` 배선이 **나중**. 지금 `sgg_nm` 완전일치 통과가 0건이라 역순이면 지역제한 공고가 화면에서 전부 사라진다.

---

## 4. 테스트 — "로더가 최소한 죽지 않는다"

**전체 재적재는 돌리지 않는다**(레이크·DB 의존). **컬럼이 밀리는 순간 실패**하게 만든다. DB 없이 돈다.

`F:/Project/eat-bid/tests/test_loader_ledger.py`:

```python
# -*- coding: utf-8 -*-
"""회차 원장 SELECT 와 COL 이름표가 어긋나면 실패한다.

2026-08-28: 로더가 a[15] 를 읽는데 컬럼은 15개(0~14)라 첫 학교에서
IndexError 로 죽었다. 파이썬 테스트 146개가 전부 통과하는 동안이었다 —
로더를 건드리는 테스트가 하나도 없었기 때문이다. 이 파일이 그 구멍이다.
"""
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "tools" / "serve" / "load_postgres.py"


def _ledger_sql(src):
    m = re.search(r"rows = duck\.execute\(\"\"\"(.*?)\"\"\"\)", src, re.S)
    assert m, "회차 원장 쿼리를 찾지 못했다 — 쿼리를 옮겼으면 이 테스트도 옮겨라"
    return m.group(1)


def _split_top_level(sel):
    out, depth, cur = [], 0, ""
    for ch in sel:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur); cur = ""
        else:
            cur += ch
    out.append(cur)
    return [c.strip() for c in out if c.strip()]


def _col_names(src):
    sql = _ledger_sql(src)
    sel = re.search(r"\bselect\b(.*?)\bfrom\b", sql, re.S | re.I).group(1)
    names = []
    for c in _split_top_level(sel):
        tok = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", c.replace(".", " "))
        names.append(tok[-1])          # 별칭이 있으면 별칭, 없으면 컬럼명
    return names


def _label_map(src):
    body = re.search(r"class COL:(.*?)\n\n", src, re.S).group(1)
    out = {}
    for line in body.strip().splitlines():
        lhs, rhs = line.split("=")
        keys = [k.strip() for k in lhs.split(",")]
        vals = [int(v.strip()) for v in rhs.split(",")]
        assert len(keys) == len(vals), f"COL 줄의 이름/값 개수가 다르다: {line}"
        out.update(dict(zip(keys, vals)))
    return out


def test_col_covers_every_select_column():
    src = SRC.read_text(encoding="utf-8")
    names, labels = _col_names(src), _label_map(src)
    assert len(labels) == len(names), (
        f"COL {len(labels)}개 vs SELECT {len(names)}개 — 컬럼을 더하고 이름표를 안 고쳤다")


def test_every_label_points_at_its_own_column():
    src = SRC.read_text(encoding="utf-8")
    names, labels = _col_names(src), _label_map(src)
    for key, idx in labels.items():
        assert 0 <= idx < len(names), f"COL.{key}={idx} 는 범위 밖 (컬럼 {len(names)}개)"
        assert names[idx] == key, f"COL.{key}={idx} 인데 그 자리는 '{names[idx]}' 다"


def _code_only(s):
    """주석을 지운다. 사고를 설명하는 주석 안의 a[15] 를 코드로 오인하면
    영원히 통과할 수 없는 테스트가 된다(초안에서 실제로 그랬다)."""
    return "\n".join(l if l.find("#") < 0 else l[:l.find("#")]
                     for l in s.splitlines())


def test_no_raw_index_into_ledger_rows():
    """a[숫자] 가 남아 있으면 실패. 이름표를 만든 이유가 이것이다."""
    bad = re.findall(r"\ba\[\d+\]", _code_only(SRC.read_text(encoding="utf-8")))
    assert not bad, f"회차 원장을 위치로 읽는 자리가 남았다: {sorted(set(bad))}"


def test_group_by_ordinals_are_within_range():
    """group by 는 1-based select 위치다. a[15] 사고가 이 혼동에서 났다."""
    sql = _ledger_sql(SRC.read_text(encoding="utf-8"))
    n = len(_col_names(SRC.read_text(encoding="utf-8")))
    ords = [int(x) for x in re.search(r"group by ([\d,\s]+)", sql, re.I).group(1).split(",")]
    for o in ords:
        assert 1 <= o <= n, f"group by {o} 는 컬럼 {n}개 범위 밖"
```

> `test_no_raw_index_into_ledger_rows` 는 **§2-2 치환을 끝내야 통과한다.** 치환 전에는 실패하는 게 맞다 — 그게 이 테스트의 목적이다.

---

## 5. 예상표 — 재적재 후 바뀔 숫자

**두 원인을 갈라야 한다. 섞으면 ux 가 회귀와 정상 변화를 못 가른다.**

### 5-A. 레이크 성장 때문에 바뀌는 것 — **이 패치와 무관**

라이브 DB는 2026-08-28 05:56 적재본이고 그 뒤 백필이 계속 돌았다. 패치를 하나도 안 넣어도 아래는 바뀐다.

| 테이블 | 현재 라이브 | 재적재 후 예상 (18:44 레이크) | 원인 |
|---|---|---|---|
| `schools` | 4,700 | **~5,520** (+820) | 백필 |
| `school_auctions` | 147,633 | **~189,000** | 백필 |
| `firms` | 4,375 | **~5,912** (+1,537) | 백필 **+ `count>=10` 문턱 제거(385곳)** |
| `firm_bids` | 7,919,833 | **~8,600,000** | 백필 |
| `school_roster` | 707,917 | **~806,960** | 백필 |
| `market_regions` | 568 | **~865** | 백필 + PK에 `sido` 추가 |
| `schools.rsd` | 4,698행 채움 | **전부 NULL** | 로더가 오늘 쓰기를 멈췄다 |

> `market_regions` 568 → 865 중 상당수는 **PK 교정으로 뭉쳐 있던 행이 갈라지는 것**이다. `북구` 1행 → 광주·울산·대구·부산 4행. **증가가 정상이다.**

### 5-B. 이 패치가 새로 채우는 것 — **값이 바뀌는 기존 컬럼은 없다**

| 컬럼 | 현재 | 후 |
|---|---|---|
| `schools.purr_cd` | 0 / 4,700 | **5,520 / 5,520 (100%)** |
| `schools.n_purr_cd` | 없음 | 1이 5,516 · **2가 4** |
| `schools.sido_cd` | 없음 | 15종 |
| `schools.med_field_all` | 없음 | 중앙값 **17** (기존 `med_field` 는 **11** 그대로) |
| `school_auctions.purr_cd`·`sido_cd` | 없음 | 100% |
| `school_auctions.n_bids` | 없음 | 회차 중앙값 **16** |
| `school_auctions.n_below_floor` | 없음 | 전체의 **43.7%** |
| `school_auctions.qualification_review` | 없음 | **true 1,789** |
| `school_auctions.allowed_regions`·`allowed_basis` | 없음 | `region-list` ~91% · `unrestricted` ~7% · `non-region-limit` ~2.5% · `unknown` 소수 |
| `firm_bids.school_id` | 없음 | 괄호 학교명 **16,285행이 처음으로 조인된다** |
| `open_auctions.sido`·`sido_cd` | 없음 | 100% |

### 5-C. 적재 요약 출력이 달라지는 것 — 🚨 **되돌리지 마라**

```
현재:  정체성: 분리 0 · 병합 0
후:    정체성: 분리 42 · 병합 4  <-- 확인 필요
```

> ## 이 문단을 지우지 마라
>
> **지금 `0 · 0` 인 것은 문제가 없어서가 아니라 `purr_cd` 가 비어 있어서다**(라이브 0/4,700 — 로더가 `a[15]` 로 죽어 못 채웠다). 이 진단은 **없는 값을 세고 있었으므로 구조적으로 항상 0**이었다.
>
> **`42 · 4` 는 나빠진 게 아니라 처음으로 보이게 된 것이다.** 42·4 는 어제도 그제도 있었고 진단만 눈을 감고 있었다. `<-- 확인 필요` 플래그가 뜨는 것이 **이 배선의 성공 조건**이다.
>
> **되돌리기 전에 확인할 것:** `분리`가 42보다 **크면** 새 문제, **42면 알려진 상태**, `SIGUNGU_CD` 재파싱 후 **2로 줄면 정상**(40건이 주소 파싱 오염이라서다). `병합`은 4가 아니면 확인 대상이다.

**42·4 가 뜨는 것이 정상이고 성공이다.** 병합 4건은 이미 이름이 나와 있다:
`창원시|진해중학교`(153043+223158) · `창원시|남산초등학교`(153045+153112) · **`강서구|송정중학교`(194559+142149 — 서울/부산)** · `동래구|사회복지법인 안음전 복지재단`

분리 42건은 대부분 **주소 파싱 오염**이다 — `급식실|봉선중학교` vs `남구|봉선중학교`, `참고|제1군수지원여단` vs `참조|…`, `평전로|내동중학교`. **진짜 다른 지역인 것은 2건**(부산 유아교육진흥원·학생인성교육원). **`SIGUNGU_CD` 재파싱이 40건을 지운다.**

---

## 6. 순서

```
① b936a99 (로더 a[15]) ──► 다음 크론(22:00 UTC)이 실제로 도는지 확인   ← 관문. 이게 먼저다
② schema.sql 추가       ──► db-migrate(PreSync)
③ 로더 패치 + 테스트     ──► 사람이 보는 앞에서 1회 수동 적재
④ allowed_regions 적재  ──► 웹 ?region= 배선            ※ 역순이면 지역제한 공고가 0건
⑤ purr_cd 적재 + 42·4  ──► 학교 문턱 제거              ※ 역순이면 문턱 제거가 A-8을 숨긴다
⑥ front 표기(작은 n)    ──► 로더 문턱 제거
⑦ 재파싱(SIGUNGU_CD)    ──► 분리 42 → 2로 줄어드는지 확인
```

**①이 관문이다.** 로더가 도는 것을 확인하기 전에는 ②③을 넣지 않는다 — 두 변경이 겹치면 실패했을 때 원인이 안 갈린다.

---

## 7. 이 패치가 **안 하는** 것 (의도적)

| 안 함 | 이유 |
|---|---|
| `med_field` 값 교체 | 화면 문구가 틀렸지만 값을 바꾸면 재적재 회귀와 구분 불가. `med_field_all` 을 옆에 싣고 이관은 별건 |
| `schools.id` 형식 변경 | URL에 들어간다 |
| 문턱 제거 (⑥·⑧·⑬) | 화면이 작은 n 을 말할 준비가 먼저 |
| 적격심사 회차를 집계에서 제외 | 표기만. 빼면 합계 감소가 회귀와 구분 불가 |
| `rank`·`bid_at`·`draw_numbers` 배선 | 각각 28.2%·49.8%·51.07%. 모르는 걸 순서로 위장하지 않는다 |
| `sgg_cd` 배선 | 코드가 아니다 |
| `bid_amount` 적재 | 790만행 COPY에 얹힌다. 재파싱 회차로 |
| `_SIDO_MAP`·`_split_address` 제거 | 표시명이 아직 문자열에서 온다. `SIGUNGU_CD` 재파싱 후 |
| `rsd` 컬럼 DROP | 데이터 삭제라 별도 승인. 지금은 NULL 로 남는다 |
