# 자료 목록 — 우리가 가진 것 전부

> **2026-09-03 · `data-inventory` · `team-lead` 요청**
> **목록이다. 판단·처방을 붙이지 않는다.** 각 항목은 `경로 · 내용 · 건수 · 창 · 만든 주체 · 상태` 여섯 칸이다.
> **측정 시각 2026-09-03. 백필 워커가 계속 쓰면 건수가 바뀐다.**

## 🔴 먼저 — 모든 승률 계산의 실질 모집단은 **233,122 회차**다

```
원시 상세 233,382 · v1 레이크 233,380 · bidlevel 233,382 · xcap2 233,380
🔴 asof   **233,122**   ← R 공급원.  가장 작다
⟹ R 이 필요한 계산(승률 곡선 · 최적 x · 항등식 · VoI · A/B)의 분모는 전부 233,122 다
   원시 대비 99.8886%.  안 붙는 260 은 채우지 않고 버린다
```

**만든 주체 표기**
```
레거시   F:/Project/eat-bid  (구 수집기·구 파서)
신       F:/Project/eat-bid-service/apps/dataplane
분석     이 세션의 분석 스크립트 (data-inventory / ml-expert / team-lead)
```

---

## 1. 원시 응답

| 경로 | 내용 | 건수 | 창 | 만든 주체 | 상태 |
|---|---|---:|---|---|---|
| `eat-bid/data/raw/internal/` | 상세 응답 원문 gzip (`{bid_id}.xml.gz`, 256 샤드) | **233,382** | 2023-08 ~ 2026-08 | 레거시 수집기 | **정본** |
| `eat-bid/data/raw/internal-list/` | 목록 응답 원문 gzip | **170** | 동일 | 레거시 수집기 | 정본 |
| (신 파이프라인 R2) | 상세·목록 응답 원문 | **미확인** | 미확인 | 신 | 미확인 — 자격증명 필요 |

**`raw/internal` 총 2.3 GB · 압축해제 평균 79.2 KB · 최대 477.6 KB.**
**응답 *전체* 가 들어 있다** (`ds_info` · `ds_bidList` · `ds_pList` · `ds_areaList` · `ds_itemList` 등 전 블록).

---

## 2. 파생 레이크 (Parquet)

| 경로 | 내용 | 건수 | 창 | 만든 주체 | 상태 |
|---|---|---:|---|---|---|
| `eat-bid/data/parquet/` | `auctions` 246,823행(고유 233,380) · `bids` 21,151,439 · `reserves` 6,994,350 · `auction_periods` 102,289 | 회차 **233,380** | 2023-08 ~ 2026-08 · 전 지역 | 레거시 파서 | **v1 — 유일한 전량본** |
| `eat-bid/data/parquet_v2/` | `auctions` 51,793 · `bids` 2,874,054 · `reserves` 775,860 | 회차 **51,793** (원시의 22.2%) | 전 월 · **서울 100% · 부산 13.1% · 경남 4.5% · 나머지 12개 지역 0%** | 레거시 파서 | **폐기** (`_DO_NOT_USE.md` 있음) |
| `eat-bid/data/parquet_v3/` | `auctions` 32,500 · `bids` 1,464,062 · `reserves` 487,230 | 회차 **32,500** | 부분 | 레거시 파서 (2026-09-02 중단) | **폐기** (`_DO_NOT_USE.md` 있음) |
| `eat-bid/data/parquet.pre-reparse/` | `auctions` 219,821행 + `MANIFEST.json` | 219,821 | 미확인 | 레거시 파서 | 백업 |

### 🔴 `v1` 중복 — **투찰·예비가격은 전 기간 2배다. 회차는 아니다**

| 테이블 | `v1` 행 | 원시 대응 | 배수 |
|---|---:|---:|---:|
| `auctions` | 246,823 | 233,382 회차 | **1.058** |
| 🔴 `bids` | 21,151,439 | 10,586,962 투찰 | **1.998** |
| 🔴 `reserves` | 6,994,350 | 3,498,060 (233,204 × 15) | **1.999** |

🔴 **`bids`·`reserves` 는 전 기간 거의 정확히 2배다.** `team-lead` 이 대조로 확인했다 — `k=2` 쌍 10,568,372 중 **금액 다름 0 · 투찰번호 다름 0**, 같은 `bid_no`·금액·`draw`·시각의 완전 동일 행.
⚠ **`auctions` 는 2배가 아니다(1.058).** 어제 본 "여섯 달 123~124%"는 **회차 테이블에만 걸린 별개 현상**이고, 투찰 2배와 겹쳐 있었다.
✅ **고유 `bid_id` 는 233,380 = 원시 233,382 − 파싱 실패 2 로 정상이다.**

🔴 **⟹ `v1` 에서 투찰 수를 세면 2배가 나온다.** `team-lead` 이 이 때문에 *"아버지 투찰 1,963"* 으로 보고했다가 정정했다. **원시 기준 `3,926` 이 맞다.**

---

## 3. 분석 행렬 (`eat-bid/data/mechanism/`)

### 3a. 현재 쓰이는 것

| 파일 | 내용 | 규모 | 창 | 만든 주체 | 상태 |
|---|---|---:|---|---|---|
| `bidlevel.npz` | `bid_id · off · x · t · wd · is_recorded_winner` | 회차 233,382 · 투찰 10,586,962 | 전수 | 분석(data-inventory) | **정본 — 투찰 단위** |
| `asof.npz` | `x · t · off · R · alpha · purr · item · ym · floor · bgng · bid_id · nbid · sido · R_suspect` | 회차 233,122 · 투찰 9,651,080 | 전수 | 분석(data-inventory) | **정본 — 회차 단위 · `R` 공급원** |
| `plist.npz` | `rate · chosen · bid_cnt · year · floor · bgng · plnprc · bid_id` (예비가격 15슬롯) | 233,204 | 전수 | 분석(team-lead) | 정본 — 예비가격 |
| `bids.npz` | `xmax · xmin · nbid · nwithdraw · votes · votes_all · xmax_nonwd …` | 233,329 | 전수 | 분석(ml-expert) | 사용 중 |
| `holdout.npz` | `bid_id · split` (TUNE / HOLD_A / HOLD_B) | 233,122 | 전수 | 분석(team-lead) | 정본 — 봉인 경계 |
| 🔴 `nhat_pool.npz` | `bid_id · P · actual_bucket · alpha · window · target` — `P̂(N_pool)` | 37,820 | 202601~202605 (TUNE) | 분석(data-inventory) | **정본 — `N̂`** `[2026-09-03 복사]` |
| `poolt.npz` | `bid_id · t · wd · off · n_pool · n_live` | 투찰 10,586,962 | 전수 | 분석(data-inventory) | 정본 — as-of `N` `[복사]` |
| `rfix.npz` | `bid_id · R_B · R_A · D_B · D_A · bgng` | 233,204 | 전수 | 분석(data-inventory) | 정본 — `R` 두 정의 `[복사]` |
| `votes2.npz` | `bid_id · votes_all · votes_live · nbid · nwithdraw` | 233,382 | 전수 | 분석(data-inventory) | 정본 — 예비가격 투표 `[복사]` |
| `census.pkl` | 전수 census 원자료 | 233,382 | 전수 | 분석(data-inventory) | 정본 — §1~§7 원자료 `[복사]` |

⚠ **다섯 개는 2026-09-03 에 세션 임시 디렉터리에서 `data/mechanism/` 으로 *복사* 했다(옮기지 않았다).** SHA-256 전부 일치 확인. **스크래치패드 원본은 그대로 둔다** — `ml-expert` 스크립트가 옛 경로를 참조할 수 있다.

### 3b. 보조·과거본

| 파일 | 내용 | 규모 | 만든 주체 | 상태 |
|---|---|---:|---|---|
| `xcap.npz` | `x · off · R · year · item · floor · nbid · bid_id` — **철회 제외** | 회차 233,349 · 투찰 9,667,069 | 분석(data-inventory) | **과거본** — `bidlevel` 이 대체 |
| `xcap2.npz` | 위 + `t · wd · is_recorded_winner · rnk · ym · R_hybrid · R_suspect · n_pool · nbid_live · bid_cnt` · 🔴 `biz_no` — **철회 포함** | 회차 233,380 · 투찰 10,586,855 · 고유 사업자 **5,956** | 분석(data-inventory) | **분석 보조** — 부록 AA·AB·AC·AD·AF·AG 가 여기서 돌았다. 파이프라인 입력 아님 |
| `n_elig.npy` | 회차별 `#{비철회 & x≥R}` | 233,380 | 분석(data-inventory) | 보조 |
| `mcnemar_A.npy` / `mcnemar_B.npy` | 제외규칙만 맞는 회차 ID / 포함규칙만 | 156 / 0 | 분석(data-inventory) | 보조 (부록 AA) |
| `disc_A_ids.npy` / `disc_B_ids.npy` | 층 분리 전 불일치 회차 ID | 156 / 16,203 | 분석(data-inventory) | 과거본 — `mcnemar_*` 가 대체 |
| `_join.npz` · `_enum_pred.npz` · `_p_alpha.npz` · `_synth_const.npz` · `_xbody.npz` · `_xbody_raw.npz` | 중간 산출 | 6~233,329 | 분석(ml-expert) | 중간 산출 |
| `A_paths.json` | 156 회차의 원시 경로 | 156 | 분석(data-inventory) | 보조 |
| 🔴 `baseline_user_mask.npz` | `biz_no · is_baseline_user · round_has_baseline_user · bid_id · off` — **`bidlevel.npz` 행 순서** | 투찰 10,586,962 · 회차 233,382 | 분석(data-inventory) | **정본 — 기준 사용자 대결용** `[2026-09-03]` |

---

## 4. 🔴 스크래치패드에만 있는 것

**경로:** `C:/Users/kano/AppData/Local/Temp/claude/C--Users-kano/f2fa05d3-.../scratchpad/`
**⚠ 세션 임시 디렉터리다. `eat-bid/data/` 안이 아니다.**

| 파일 | 내용 | 규모 | 만든 주체 | 상태 |
|---|---|---:|---|---|
| ✅ **`nhat_pool.npz`** | `P̂(N_pool)` | 37,820 | 분석(data-inventory) | **`data/mechanism/` 으로 복사 완료 (2026-09-03).** 여기 원본은 보존 |
| `nhat_tune2.npz` | `P̂(N_live)` (ALPHA·temperature) | 37,820 | 분석(data-inventory) | 과거본 — `nhat_pool` 이 대체 |
| `nhat_tune.npz` · `nhat.npz` | 그 이전 판 | 37,820 / 52,236 | 분석(data-inventory) | 과거본 |
| ✅ `poolt.npz` | 위와 같음 | 투찰 10,586,962 | 분석(data-inventory) | **복사 완료.** 원본 보존 |
| ✅ `rfix.npz` | 위와 같음 | 233,204 | 분석(data-inventory) | **복사 완료.** 원본 보존 |
| ✅ `votes2.npz` | 위와 같음 | 233,382 | 분석(data-inventory) | **복사 완료.** 원본 보존 |
| `act_good.npy` · `act_new.npy` | 투찰 단위 라벨 | 9,667,069 | 분석(ml-expert) | 중간 산출 |
| ✅ `census.pkl` (+ `census.json` · `census_list.*`) | 전수 census 원자료 | 233,382 | 분석(data-inventory) | **`census.pkl` 복사 완료.** 나머지는 스크래치패드에만 |
| `gh_ids.pkl` | 김해 회차 ID + 공고월 | 7,175 | 분석(data-inventory) | 보조 (부록 AD) |
| `mech.pkl` | 기전 검증 원자료 | — | 분석(data-inventory) | 보조 (부록 C) |
| `*.parquet` · `*.pkl` (2026-08-26 자, **37개 · 약 1.5 GB**) | `eatcf_stash_split1/2`(679/415 MB) · `merged.parquet`(125 MB) · `fitted.pkl`(113 MB) · `cond_models.pkl` · `auctions_*` · `bids_*` · `auc_*` · `tie_*` · `records*` · `win_arrays` 등 | | 이전 세션 | 🔴 **[출처 영구 미상 · 사용 금지 · 삭제 금지 · 사장 확인 완료]** |

### ✅ 출처 미상 37개 — **격리 확인 완료 (2026-09-03)**

**"우리 결론 중 저것을 참조하는 게 있나"를 파일명으로 훑었다(파일은 안 열었다):**

| 대상 | 참조 |
|---|---|
| `eat-bid-service/docs/` 전체 (부록 · ADR · PLAN) | **0** — 이 목록이 *나열* 하는 것뿐 |
| 이번 세션 분석 스크립트 (`scratchpad/*.py`, 2026-09-01 이후) | **0** — 이 목록을 쓴 스크립트뿐 |
| 프로젝트 코드 (`eat-bid/src` · `eat-bid/scripts` · `apps/dataplane/src`) | **0** |

**⟹ 우리 결론 중 이 자료 위에 서 있는 것은 없다. 격리됐다.**
⚠ **사장님도 출처를 모르신다. 영구 미상으로 닫는다.**

---

## 5. 상태·설정 파일

| 경로 | 내용 | 창 | 만든 주체 | 상태 |
|---|---|---|---|---|
| `eat-bid/data/state.sqlite` | 크롤 진행 상태 (10.3 MB) | ~2026-08-30 11:21 | 레거시 수집기 | 참고 |
| `eat-bid/data/state-18a/b/c.sqlite` | 지역코드 18 샤드 워커 상태 | ~2026-08-28 | 레거시 수집기 | 참고 |
| `eat-bid/data/crawl-guard.json` | 크롤 가드 트립 기록 | ~2026-08-29 | 레거시 수집기 | 참고 |
| `eat-bid/data/source-drift.json` · `.quarantine.json` | 스키마 드리프트 격리 | ~2026-09-02 | 레거시 수집기 | 참고 |
| `eat-bid/data/_reparse_v3.log` | 재파싱 로그 | 2026-09-02 | 레거시 | **0 바이트 (비어 있음)** |
| `eat-bid/data/reference/moe_sido_sigungu.csv` · `sgg_center_2017.csv` | 시도·시군구 참조표 | — | 외부 | 참고 |
| `eat-bid/data/bidboard/*.json` | `all_schools` · `market_map` · `open_auctions` | — | 분석(이전 세션) | 출처 미확인 |
| `eat-bid/data/_sido_codes.txt` · `_sido_coverage.txt` · `_tmp/` | 메모 | 2026-08-27 | 분석(이전 세션) | 참고 |

---

## 6. 목록 자체에 대한 사실

```
원시 상세          233,382 파일
v1 레이크 고유      233,380 회차   (= 원시 − 파싱 실패 2)
bidlevel           233,382 회차   (원시와 같음)
xcap2              233,380 회차   (예정가 필드 결측 2 제외)
asof               233,122 회차   (ds_pList 조건 미충족 260 제외)
xcap (과거본)       233,349 회차   (전원 철회 회차 31 제외 · 철회 투찰 제외)
plist              233,204 회차
bids               233,329 회차
```
⚠ **일곱 개 산출물의 회차 수가 전부 다르다. 차이는 각각 다른 사유다.**
✅ **`nhat_pool.npz` 외 4개는 2026-09-03 에 `data/mechanism/` 으로 복사했다** (SHA-256 일치 · 원본 보존).
✅ **2026-08-26 자 스크래치패드 산출물 37개(약 1.5 GB)는 출처 영구 미상이고, 우리 결론 중 참조하는 것이 0 이다.**
