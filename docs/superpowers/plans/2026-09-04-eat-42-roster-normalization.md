# EAT-42 명단·예비가격 블록 정규화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상세 응답의 `ds_bidList`(명단)·`ds_pList`(추첨 예비가격)·`ds_bidHistory`(재입찰 사슬)를 `eat-v2` 검토된 파서로 읽어 versioned normalized model에 싣고, 233,382건 전수 재정규화로 격리율과 26,000 조사값을 재현한다.

**Architecture:** 계약은 두 겹이다. wire 겹은 `schema_contract.py`의 검토된 column 목록과 필수 부분집합 fingerprint가 소유하고, normalized 겹은 `packages/contracts`의 Zod → JSON Schema → Pydantic 생성물이 소유한다. `eat-v1`은 바이트 하나 건드리지 않고 `eat-v2`를 **더한다**(ADR 0029). 새 블록 해석은 `normalize.py`가 아니라 새 모듈 `source/eat/roster.py`가 소유하고, `normalize.py`는 parser version 분기만 한다.

**Tech Stack:** Zod 4(`safeExtend`, `z.toJSONSchema`), `datamodel-codegen`(pydantic v2), Python 3.12 + Pydantic strict, defusedxml, pytest, bun:test.

**Spec:** Linear EAT-42, ADR 0029(`docs/adr/0029-eat-v2-bid-list-contract.md`), ADR 0025, `docs/product/decision-screen-v2/architecture.md` §1·§3, `docs/architecture/domain-and-data.md` §3.3·§3.4, `docs/evidence/source-boundary/2026-09-03-bid-roster-in-detail.md`.

**전제:** EAT-34 브랜치가 main에 merge된 상태에서 실행한다. 즉 `ReviewedSchemaContract`에 `required` 필드와 필수 부분집합 fingerprint가 이미 있고, `_contract_fingerprint`가 `required_datasets`로 계산한다.

---

## Global Constraints

- **`eat-v1`을 수정하지 않는다.** `_EAT_V1_BID_DETAIL`의 `datasets`·`required` 어느 쪽도 건드리지 않는다. 두 mapping 중 하나라도 바뀌면 fingerprint가 바뀌고 그 이름으로 봉인된 publication membership(ADR 0025)과 attempt lineage(ADR 0014)가 무효가 된다.
- **`EatbidIngestionAuctionV1` root 계약을 수정하지 않는다.** `pipeline/project.py`의 `parse_canonical_normalized_auction`은 저장된 canonical payload를 다시 model로 읽은 뒤 **다시 직렬화해 바이트 동일성을 검사한다**. v1 root에 필드를 더하면 optional이든 required든 봉인된 payload가 전부 실패한다. 그러므로 v2는 **별도 root 계약** `EatbidIngestionAuctionV2`다.
- **문자열을 정체성으로 쓰지 않는다.** 사업자번호 `BIZ_NO`, 업체 코드 `SHIPPER_CD`, 업체명 `SHIPPER_NM`은 전부 `(source_system, code_scheme, code)` 관측값이다. 어느 것도 PK·조인 키로 쓰지 않는다(AGENTS 2).
- **원본 판정을 추측 매핑하지 않는다.** 2026-09-04 레이크 실측(1,500건 51,912행)에서 `BID_STT`는 `002`(낙찰)와 `005`(낙찰실패) 두 값뿐이다. 소스에는 "하한미달"도 "무효"도 없다. 판정은 `sourceCodedValue`로 그대로 싣고 무효 여부를 파서가 만들어내지 않는다(AGENTS 3).
- **하한과 예정가격을 계산하지 않는다.** 하한율은 `ds_info.PLNPRCE_SUCBD_STD` 관측값, 예정가격은 `ds_info.ELCTRN_BID_PLNPRC` 관측값이다. 추첨 후보 넷의 평균이 예정가격과 같다는 것은 **검증하는 불변식**이지 값을 만드는 규칙이 아니다.
- **차수를 문자열에서 파싱하지 않는다.** `ETN_BID_NO`의 `-0/-1/-2` 접미사를 회차로 읽지 않는다. 재입찰 관계는 `ds_bidHistory`의 `ETN_BID_ID`와 `ds_info.UP_ELCTRN_BID_ID`라는 원본 관계로만 잇는다(AGENTS 4).
- **값의 단위를 원시값에 숨기지 않는다.** 사정률·하한율은 `BidRate`(percentage-points, 소수 3자리), 추첨 비율은 `Ratio`(소수 6자리), 금액은 `Money`(KRW, 소수 2자리), 시각은 `InstantText`다. `float`·plain `str`로 계층 경계를 넘기지 않는다(AGENTS 15, 규칙 17 Python gate).
- **계약은 atom → value → resource → root 순서로 조립한다.** ingestion family 안에서만 `safeExtend`하고 API/DB family에서 `pick`하지 않는다(AGENTS 16).
- **300줄 규칙.** `normalize.py`는 이미 280줄대다. 새 블록 해석은 `source/eat/roster.py`가 소유하고 `normalize.py`는 분기와 v1 경로만 남긴다(AGENTS 18).
- **한국어.** 새 production 모듈 첫 docstring은 `모듈 책임:`으로 시작한다(AGENTS 23). 판단 경계에는 한국어 why 주석(AGENTS 13). pytest 함수명에 한글 음절(AGENTS 14). 커밋 메시지 한국어.
- 커밋 본문 마지막 블록에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`과 `Claude-Session: https://claude.ai/code/session_01JCsr2N2vuZVbre9agy38J9`를 빈 줄 없이 한 블록으로 둔다.
- 실행 명령은 EAT-42 worktree 루트에서 단일 명령으로 실행한다. `cd`·`git -C`로 감싸지 않는다.
- 서브에이전트는 하위 에이전트를 만들지 않는다.

### Non-goals (이 슬라이스에서 하지 않는다)

| 하지 않는 것 | 어디로 |
| -- | -- |
| `core.bid_submission`·`award_decision`·`supplier_party`·`source_supplier_account`·`auction_attempt_link` Drizzle 스키마와 마이그레이션 | EAT-43 |
| v2 payload를 core로 넣는 projector와 `postgres_projection_writer` 확장 | EAT-43 |
| 투찰 행 연도 파티션 ADR | EAT-43 |
| `mart.org_round_summary` 등 mart 넷과 build id 전환 | EAT-44 |
| 수집 실행·수집 모드 | EAT-34(merged) |
| 화면·API 계약 | EAT-36~40 |

이 슬라이스가 끝나면 v2 정규화 산출물은 `ingest.normalized_record`까지만 간다. v2 record를 core로 넣는 경로는 T4에서 **typed 실패로 명시적으로 막는다**. 조용히 v1으로 오해석되게 두지 않는다.

---

## 실측 근거 (2026-09-04, 로컬 레이크 `F:/Project/eat-bid/data/raw/internal`)

계획의 모든 결정은 아래 관측에서 나왔다. 구현자가 재현할 수 있어야 하므로 값과 표본을 함께 남긴다.

| 관측 | 값 | 표본 |
| -- | -- | -- |
| `ds_bidList` column 수 | 55 | 5669410 |
| `ds_pList` column 수 | 5 (`ELCTRN_BID_ID` `CMNM_PLNPRC_RT` `CMNM_PLNPRC` `CMNM_PLNPRC_SN` `CHC_YN`) | 5669410 |
| `ds_bidHistory` column 수 | 34 (목록 모양) | 5306521 |
| `BID_STT` 관측값 | `002` 낙찰, `005` 낙찰실패 — **그 둘뿐** | 1,500건 51,912행 |
| 회차당 `002` 행 수 | 정확히 1 | 300건 |
| `SAJEONG_PCT` 소수 자릿수 | 3자리 10,630 · 2자리 1,147 · 1자리 123 · 0자리 12 | 11,912행 |
| `CMNM_PLNPRC_RT` 소수 자릿수 | 4자리 우세, 3·2·0자리 섞임 | 4,500행 |
| `CHC_YN='Y'` 개수 | 항상 4 | 999건 |
| `round(mean(chosen CMNM_PLNPRC)) == ELCTRN_BID_PLNPRC` | 999 / 999 일치, 불일치 0 | 999건 |
| 낙찰 행이 하한율 미만인 경우 | 0 / 1,500 | 1,500건 |
| `SAJEONG_PCT < PLNPRCE_SUCBD_STD` 비율 | **43.8%** (문서의 26,000 조사값은 41.3%) | 1,500건 51,912행 |
| 유효 투찰 1·2등 격차 중앙 | **0.153%p** (문서의 26,000 조사값은 0.061%p) | 1,445회차 |
| `PLNPRCE_SUCBD_STD` 관측값 | `90`(990) `88`(502) `84.245` `87.745` `82.995` | 1,500건 |
| `ds_info` 채움률 | `PLNPRCE_SUCBD_STD` `ELCTRN_BID_PLNPRC` `BGNG_PRC` `OPNG_DT` `RBID_YN` 100%, `UP_ELCTRN_BID_ID` 3.4% | 무작위 2,000건 |
| `ds_bidHistory` 보유율 | 2.4% (architecture.md 기록은 3.28%) | 1,000건 |
| `ELCTRN_BID_STT_NM` 분포 | **낙찰 2,000 / 2,000** | 무작위 2,000건 |

⚠ **마지막 줄이 이 계획에서 가장 중요한 제약이다.** 레거시 레이크는 개찰이 끝나고 낙찰된 공고만 담고 있다. 유찰·취소·개찰 전 상세의 모양은 **관측된 적이 없다**. 그러므로 "명단이 항상 있다", "예정가격이 항상 있다"를 계약에 넣으면 관측하지 않은 것을 단언하는 것이다(AGENTS 3).

⚠ 격차 중앙 0.153%p와 무효 43.8%는 문서의 26,000 조사값(0.061%p, 41.3%)과 다르다. 표본이 다르기 때문이다(이 측정은 shard 앞쪽 = 오래된 id 편향, 명단 규모가 작다). T6의 리포트는 **코호트를 명시해 재현**하는 것이지 임의 표본에서 같은 숫자가 나오길 기대하는 것이 아니다. 숫자를 테스트에 하드코딩하지 않는다.

---

## 파일 구조

| 경로 | 책임 |
| -- | -- |
| `packages/contracts/src/values/source-coded-value.ts` | `(sourceSystem, codeScheme, code, label)` 외부 코드 value |
| `packages/contracts/src/ingestion/v2/resources/supplier-account.ts` | 소스 참여 계정 관측값 |
| `packages/contracts/src/ingestion/v2/resources/bid-submission.ts` | 명단 한 행 |
| `packages/contracts/src/ingestion/v2/resources/bid-roster.ts` | 명단 블록 |
| `packages/contracts/src/ingestion/v2/resources/award-decision.ts` | 낙찰 행과 2등 |
| `packages/contracts/src/ingestion/v2/resources/reserve-price-draw.ts` | 복수예정가격 추첨 |
| `packages/contracts/src/ingestion/v2/resources/attempt-link.ts` | 재입찰 사슬 링크 |
| `packages/contracts/src/ingestion/v2/resources/auction-terms.ts` | 하한율·예가 방식·낙찰 방식 |
| `packages/contracts/src/ingestion/v2/normalized-auction.ts` | `normalizedAuctionV2Schema` root |
| `packages/contracts/src/portable-registry.ts` | 두 root 계약 등록(artifact 파일명 포함) |
| `packages/contracts/src/generate-json-schema.ts` | 계약별 artifact emit/check |
| `packages/contracts/generated/ingestion-v2.schema.json` | 생성물 |
| `apps/dataplane/scripts/generate_contract_models.py` | 계약별 Pydantic 모듈 생성 |
| `apps/dataplane/src/eatbid/generated/ingestion_v2.py` | 생성물 |
| `apps/dataplane/src/eatbid/source/eat/schema_contract.py` | `eat-v2` 검토 계약 두 개 추가 |
| `apps/dataplane/src/eatbid/source/eat/registry.py` | transport와 schema 분리, parser version 인자화 |
| `apps/dataplane/src/eatbid/source/eat/wire_values.py` | 사정률·비율·`BID_DT` 시각 helper |
| `apps/dataplane/src/eatbid/source/eat/roster.py` | **신규** 세 블록 해석 |
| `apps/dataplane/src/eatbid/source/eat/normalize.py` | parser version 분기 + v2 조립 |
| `apps/dataplane/src/eatbid/pipeline/normalize.py` | record_type을 registry에서 읽는다 |
| `apps/dataplane/src/eatbid/pipeline/discover.py`, `discovery_persistence.py` | parser version 전달 |
| `apps/dataplane/src/eatbid/pipeline/project.py` | v2 record_type을 typed 실패로 닫는다 |
| `apps/dataplane/tests/fixtures/eat/bid-detail-roster.xml` | 남산초 축약·가명 fixture |
| `apps/dataplane/tests/fixtures/eat/bid-detail-rebid.xml` | 재입찰 사슬 fixture |
| `apps/dataplane/tests/fixtures/eat/bid-detail-no-roster.xml` | 블록 없는 합성 fixture |
| `apps/dataplane/tests/unit/test_eat_roster.py` | 블록 파서 단위 테스트 |
| `apps/dataplane/tests/unit/test_eat_normalize_v2.py` | v2 정규화·격리 테스트 |
| `apps/dataplane/scripts/renormalize_lake_report.py` | 전수 재정규화 리포트 |
| `apps/dataplane/tests/integration/test_lake_renormalization.py` | 레이크 있을 때만 도는 대조 테스트 |
| `docs/evidence/normalization/2026-09-04-eat-v2-renormalization.md` | 리포트 산출물 |

---

## 결정 요약

| # | 질문 | 결정 | 근거 |
| -- | -- | -- | -- |
| 1 | `eat-v2` 신설 vs v1 required 확장 | **`eat-v2` 신설.** `bid-detail`과 `bid-list` 둘 다 v2 항목을 만든다 | ADR 0029 Accepted. v1의 `required`를 바꾸면 fingerprint가 바뀌어 봉인된 publication이 무효가 된다. 실행 단위가 parser version 하나이므로(`discover_release`가 `plan.parser_version != contract.parser_version`을 검사) 목록도 같은 이름의 항목이 있어야 한다 |
| 1b | v2 `required`에 새 블록을 넣나 | **넣지 않는다.** v1과 같은 `ds_info` 넷을 그대로 쓴다 | fingerprint는 "관측된 required column"으로 계산되므로 명단 없는 공고(유찰·개찰 전)가 전부 계약 위반이 된다. 레이크는 낙찰 공고만 담고 있어 그 모양을 관측한 적이 없다. 새 column은 `datasets`에만 넣고 행 단위 필수성은 파서가 강제한다(`ds_areaList.PDLC_CD` 선례) |
| 2 | normalized model 확장 방법 | **별도 root `EatbidIngestionAuctionV2`**를 `normalizedAuctionV1Schema.safeExtend`로 만든다 | `project.py`가 canonical payload를 재직렬화해 바이트 동일성을 검사한다. v1 root에 optional 필드를 더해도 `model_dump`가 `null` 키를 뱉어 봉인된 payload가 전부 깨진다 |
| 3 | 격리 규칙 | **블록 부재는 격리하지 않고 빈 값으로 정규화한다. 블록이 있는데 행이 해석되지 않으면 그 관측을 격리한다** | EAT-42 본문 "파싱 실패는 격리한다". 부재는 실패가 아니라 `unknown`이며 유효한 상태다. 격리가 생기면 `validate_completeness`가 `quarantined != 0`으로 publish를 막는다 — 이 동작은 이미 있고 바꾸지 않는다 |
| 4 | fixture 가명화 | **가명화한다.** `BIZ_NO`·`SHIPPER_BRNO`·`SHIPPER_NM`·`SHIPPER_CD`·`FRST_RGTR_ID`·`LAST_CHGR_ID`·`SGNNG_ID`·`BID_NO`·`PURR_NM`·`BID_NM`을 합성값으로 바꾸고 `SAJEONG_PCT`·`BID_CALC_AMT`·`RNK`·`BID_STT`·`DRAW_NO`·`WITHDRAWAL_YN`·`CMNM_PLNPRC*`는 관측 그대로 둔다 | fixture는 저장소에 영구히 남는 배포물이고 실제 사업자의 식별자를 담을 이유가 없다. 기존 `bid-detail-one.xml`이 이미 "비식별 구매기관" 관례를 세웠다. 수치 재현은 fixture가 아니라 T6의 레이크 리포트가 한다 |

---

### Task 1: 레이크에서 fixture 셋을 뽑아 가명화해 커밋한다

**Files:**
- Create: `apps/dataplane/tests/fixtures/eat/bid-detail-roster.xml`
- Create: `apps/dataplane/tests/fixtures/eat/bid-detail-rebid.xml`
- Create: `apps/dataplane/tests/fixtures/eat/bid-detail-no-roster.xml`
- Modify: `docs/evidence/source-boundary/2026-09-03-bid-roster-in-detail.md` (§6 "확인하지 않은 것" 세 항목을 확인된 사실로 옮긴다)

**Interfaces:** 다음 Task들이 읽는 fixture 상수.

| fixture | 원본 | 담는 모양 |
| -- | -- | -- |
| `bid-detail-roster.xml` | `ELCTRN_BID_ID=5669410` (창원 남산초 축산, 2025-11-20 개찰) | `ds_bidList` 8행(RNK 1·2·3·4·5·6과 `WITHDRAWAL_YN=Y` 1행, 하한 미만 1행), `ds_pList` 15행(`CHC_YN=Y` 4), `ds_info` 필요한 column, `ds_areaList` 1행. `ds_bidHistory` 없음 |
| `bid-detail-rebid.xml` | `ELCTRN_BID_ID=5306521` (2023-09-21 재입찰) | `ds_bidHistory` 3행, `ds_bidList` 2행, `ds_info.UP_ELCTRN_BID_ID=5306354` |
| `bid-detail-no-roster.xml` | **합성** (`bid-detail-one.xml`에서 파생) | `ds_info` + `ds_areaList`만. 세 블록 전부 없음 |

세 번째가 합성인 이유를 파일 주석에 남긴다: 레이크 무작위 2,000건이 전부 `ELCTRN_BID_STT_NM=낙찰`이라 명단 없는 상세를 관측한 적이 없다. 그래도 파서는 그 경우를 격리하지 않아야 하므로 합성 입력으로 그 계약을 고정한다.

- [ ] **Step 1: 원본 위치 확인** — 레이크는 `<bidId>.xml.gz`를 두 자리 hex shard에 담는다.

```bash
find /f/Project/eat-bid/data/raw/internal -name "5669410.xml.gz"
find /f/Project/eat-bid/data/raw/internal -name "5306521.xml.gz"
```

`ds_bidHistory`가 든 다른 상세를 새로 찾아야 하면:

```bash
python - <<'PY'
import gzip, os
root = r'F:/Project/eat-bid/data/raw/internal'
for shard in sorted(os.listdir(root))[:20]:
    directory = os.path.join(root, shard)
    for name in sorted(os.listdir(directory))[:40]:
        path = os.path.join(directory, name)
        if b'ds_bidHistory' in gzip.open(path, 'rb').read():
            print(path)
PY
```

- [ ] **Step 2: 축약·가명화 스크립트를 scratchpad에서 한 번 실행한다** — 스크립트는 저장소에 커밋하지 않는다. 생성물만 커밋한다.

```python
# scratchpad/build_roster_fixture.py
import gzip
import xml.etree.ElementTree as ET

NS = "http://www.nexacroplatform.com/platform/dataset"
ET.register_namespace("", NS)
Q = f"{{{NS}}}"

# 관측값 그대로 두는 column. 테스트가 검증하는 값이고 개인·업체 식별자가 아니다.
KEEP = {
    "RNK", "RNK2", "RNK3", "BID_STT", "BID_STT_NM", "SAJEONG_PCT", "BID_CALC_AMT",
    "EFT_ALL_AMT", "DRAW_NO", "WITHDRAWAL_YN", "TOTAL_NUM", "BID_DT", "BID_END_DT",
    "SUCBD_DT", "SUCBD_DECISION_MTHD", "ELCTRN_BID_ID",
    "CMNM_PLNPRC", "CMNM_PLNPRC_RT", "CMNM_PLNPRC_SN", "CHC_YN",
}
# 합성값으로 바꾸는 column. 실제 사업자·담당자 식별자다.
PSEUDONYM = {
    "BIZ_NO": lambda i: f"{1000000000 + i * 7:010d}",
    "SHIPPER_BRNO": lambda i: f"{1000000000 + i * 7:010d}",
    "SHIPPER_CD": lambda i: f"{200000 + i:06d}",
    "SHIPPER_NM": lambda i: f"비식별 업체 {i + 1}",
    "FRST_RGTR_ID": lambda i: f"user{i:04d}",
    "LAST_CHGR_ID": lambda i: "S000000000",
    "SGNNG_ID": lambda i: f"{100000000 + i:09d}",
    "BID_NO": lambda i: f"B000000-{i:06d}",
    "NARA_BIZ_NO": lambda i: "부정당업자가 아닙니다.",
}

def load(path):
    return ET.fromstring(gzip.open(path, "rb").read().decode("utf-8"))

def dataset(root, name):
    return next(d for d in root.iter(Q + "Dataset") if d.get("id") == name)

def rows(node):
    return node.findall(f"{Q}Rows/{Q}Row")

def pseudonymize(root):
    for index, row in enumerate(rows(dataset(root, "ds_bidList"))):
        for col in row.findall(Q + "Col"):
            builder = PSEUDONYM.get(col.get("id"))
            if builder is not None:
                col.text = builder(index)
    info = rows(dataset(root, "ds_info"))[0]
    for col in info.findall(Q + "Col"):
        if col.get("id") == "PURR_NM":
            col.text = "비식별 구매기관"
        if col.get("id") == "BID_NM":
            col.text = "비식별 급식 식재료 구매"
        if col.get("id") in {"FRST_RGTR_ID", "LAST_CHGR_ID"}:
            col.text = "S000000000"

def trim_bid_list(root, keep_indexes):
    node = dataset(root, "ds_bidList")
    container = node.find(Q + "Rows")
    kept = [row for index, row in enumerate(rows(node)) if index in keep_indexes]
    for row in rows(node):
        container.remove(row)
    for row in kept:
        container.append(row)

source = load(r"F:/Project/eat-bid/data/raw/internal/d3/5669410.xml.gz")
# 앞 여섯 행(RNK 1~6) + 철회 행 + 하한 미만 행을 남긴다. 인덱스는 실행 시 확인해 채운다.
trim_bid_list(source, {0, 1, 2, 3, 4, 5, 82, 84})
pseudonymize(source)
ET.ElementTree(source).write(
    r"F:/Project/eat-bid-service/apps/dataplane/tests/fixtures/eat/bid-detail-roster.xml",
    encoding="utf-8", xml_declaration=True,
)
```

`ds_info`에서 fixture에 남길 column은 `ELCTRN_BID_ID ELCTRN_BID_NO BID_NM ELCTRN_BID_STT_NM PURR_CD PURR_NM SIDO_CD SIGUNGU_CD PBANC_YMD BID_END_DT OPNG_DT BGNG_PRC ELCTRN_BID_PLNPRC MAIN_ITEMS PLNPRCE_SUCBD_STD PLNPRC_TYPE_CD PLNPRCE_TYPE_NM SUCBD_DECISION_MTHD_NM BID_CNT UP_ELCTRN_BID_ID RBID_YN` 스물 하나다. 나머지 95개는 fixture에서 뺀다 — 계약이 읽지 않고, 남기면 fixture가 무엇을 고정하는지 흐려진다.

⚠ 하한 미만 행을 남기려면 원본 85행 중 `SAJEONG_PCT < 90` 인 행이 있어야 한다. 5669410은 최저가 90.218이라 하한 미만 행이 **없다.** 그러므로 하한 미만 케이스는 `bid-detail-rebid.xml`이나 별도 레이크 상세에서 가져오고, 없으면 `bid-detail-roster.xml`에 합성 행을 **추가하지 말고** T5의 단위 테스트가 인라인 XML로 만든다. 실제 관측 fixture에 합성 행을 섞지 않는다.

- [ ] **Step 3: 생성물 확인** — 파일이 UTF-8이고 `parse_nexacro`가 읽히는지 확인한다.

```bash
uv run --project apps/dataplane python -c "from pathlib import Path; from eatbid.source.eat.xml import parse_nexacro; p=Path('apps/dataplane/tests/fixtures/eat/bid-detail-roster.xml').read_bytes(); r=parse_nexacro(p, require_ds_info=True); print({k: len(v) for k, v in r.datasets.items()})"
```

- [ ] **Step 4: 가명화 검증** — fixture에 실제 사업자번호가 남지 않았는지 확인한다.

```bash
grep -c "3659402127\|8498702568\|해오름\|남산초" apps/dataplane/tests/fixtures/eat/bid-detail-roster.xml
```
0이 아니면 Step 2로 돌아간다.

- [ ] **Step 5: 커밋** — `test(data): 명단·예비가격·재입찰 블록 fixture를 가명화해 들인다`

---

### Task 2: normalized v2 계약을 Zod로 조립하고 artifact를 계약별로 낸다

**Files:**
- Create: `packages/contracts/src/values/source-coded-value.ts`
- Create: `packages/contracts/src/ingestion/v2/resources/{supplier-account,bid-submission,bid-roster,award-decision,reserve-price-draw,attempt-link,auction-terms}.ts`
- Create: `packages/contracts/src/ingestion/v2/normalized-auction.ts`
- Modify: `packages/contracts/src/portable-registry.ts`, `packages/contracts/src/generate-json-schema.ts`, `packages/contracts/src/index.ts`
- Create: `packages/contracts/generated/ingestion-v2.schema.json` (생성물)
- Test: `packages/contracts/src/ingestion/v2/normalized-auction.test.ts`, `packages/contracts/src/portable-registry.test.ts` 갱신

**Interfaces:**
- Produces: `normalizedAuctionV2Schema`(id `EatbidIngestionAuctionV2`), `sourceCodedValueSchema`, `normalizedBidSubmissionSchema`, `normalizedBidRosterSchema`, `normalizedAwardDecisionSchema`, `normalizedReservePriceDrawSchema`, `normalizedAttemptLinkSchema`, `normalizedAuctionTermsSchema`, `renderPortableSchema`, `emitPortableSchemas`, `checkPortableSchemas`.
- Preserves: `renderIngestionV1Schema`, `emitIngestionV1Schema`, `checkIngestionV1Schema`, `ingestionV1SchemaPath` (기존 테스트가 부른다).

- [ ] **Step 1: 실패하는 테스트 작성** — `packages/contracts/src/ingestion/v2/normalized-auction.test.ts`

```ts
import { describe, expect, test } from "bun:test";

import { normalizedAuctionV1Schema } from "../v1/normalized-auction";
import { normalizedAuctionV2Schema } from "./normalized-auction";

const v1Fixture = {
  contractVersion: "eatbid.ingestion.auction.v1",
  identity: {
    externalBidId: "5669410",
    displayBidNumber: "E251117-000000-0",
    title: "비식별 급식 식재료 구매",
    status: "낙찰",
  },
  buyer: { organizationCode: "153045", organizationName: "비식별 구매기관" },
  location: { sidoCode: "15", sigunguCode: "653", eligibilityCodes: ["15653"] },
  schedule: {
    announcedAt: "2025-11-17T00:00:00Z",
    deadlineAt: "2025-11-20T01:00:00Z",
    openedAt: "2025-11-20T02:20:00Z",
  },
  pricing: {
    baseAmount: { amount: "6913400.00", currency: "KRW" },
    plannedAmount: { amount: "6762461.00", currency: "KRW" },
  },
  classification: { sourceCategoryLabel: "축산물", categorySource: "source-field" },
} as const;

const account = {
  sourceSystem: "eat",
  accountCode: { sourceSystem: "eat", codeScheme: "eat:SHIPPER_CD", code: "221212", label: "비식별 업체 1" },
  businessNumber: { sourceSystem: "eat", codeScheme: "eat:BIZ_NO", code: "1000000000", label: null },
} as const;

const v2Fixture = {
  ...v1Fixture,
  contractVersion: "eatbid.ingestion.auction.v2",
  terms: {
    floorRate: { value: "90.000", unit: "percentage-points" },
    plannedPriceMethod: { sourceSystem: "eat", codeScheme: "eat:PLNPRC_TYPE_CD", code: "002", label: "복수예정가격" },
    awardMethod: { sourceSystem: "eat", codeScheme: "eat:SUCBD_DECISION_MTHD", code: "003", label: null },
  },
  roster: {
    sourceRosterSize: 85,
    submissions: [
      {
        supplierAccount: account,
        submittedAt: "2025-11-19T09:14:39Z",
        amount: { amount: "6101000.00", currency: "KRW" },
        effectiveAmount: { amount: "6101000.00", currency: "KRW" },
        bidRate: { value: "90.218", unit: "percentage-points" },
        rank: 1,
        sourceStatus: { sourceSystem: "eat", codeScheme: "eat:BID_STT", code: "002", label: "낙찰" },
        withdrawalFlag: { sourceSystem: "eat", codeScheme: "eat:WITHDRAWAL_YN", code: "N", label: null },
        drawNumbers: ["7", "3"],
        observedRosterSize: 85,
      },
    ],
  },
  award: {
    supplierAccount: account,
    awardedAt: "2025-11-20T00:00:00Z",
    awardedRate: { value: "90.218", unit: "percentage-points" },
    awardedAmount: { amount: "6101000.00", currency: "KRW" },
    runnerUpRate: { value: "90.382", unit: "percentage-points" },
    sourceStatus: { sourceSystem: "eat", codeScheme: "eat:BID_STT", code: "002", label: "낙찰" },
  },
  reservePriceDraw: {
    candidates: [
      {
        sequence: 1,
        ratio: { value: "0.971700", unit: "ratio" },
        amount: { amount: "6717477.00", currency: "KRW" },
        chosen: { sourceSystem: "eat", codeScheme: "eat:CHC_YN", code: "Y", label: null },
      },
    ],
  },
  lineage: { parentExternalBidId: null, links: [] },
} as const;

describe("normalizedAuctionV2Schema", () => {
  test("v1 root는 v2 필드가 없어도 그대로 통과한다", () => {
    expect(normalizedAuctionV1Schema.parse(v1Fixture)).toEqual(v1Fixture);
  });

  test("v1 payload는 v2 root를 통과하지 못한다", () => {
    expect(() => normalizedAuctionV2Schema.parse(v1Fixture)).toThrow();
  });

  test("명단 한 행이 단위 봉투를 갖춘 채로 통과한다", () => {
    expect(normalizedAuctionV2Schema.parse(v2Fixture)).toEqual(v2Fixture);
  });

  test("사정률을 숫자로 넘기면 거부한다", () => {
    const broken = structuredClone(v2Fixture) as Record<string, unknown>;
    (broken.roster as { submissions: { bidRate: unknown }[] }).submissions[0].bidRate = 90.218;
    expect(() => normalizedAuctionV2Schema.parse(broken)).toThrow();
  });

  test("소수 세 자리가 아닌 사정률 문자열을 거부한다", () => {
    const broken = structuredClone(v2Fixture) as Record<string, unknown>;
    (broken.roster as { submissions: { bidRate: { value: string } }[] }).submissions[0].bidRate.value = "91.87";
    expect(() => normalizedAuctionV2Schema.parse(broken)).toThrow();
  });

  test("명단이 비어 있고 낙찰이 없는 상세도 유효한 v2 record다", () => {
    const empty = {
      ...v2Fixture,
      roster: { sourceRosterSize: null, submissions: [] },
      award: null,
      reservePriceDraw: { candidates: [] },
    };
    expect(normalizedAuctionV2Schema.parse(empty).award).toBeNull();
  });

  test("root id는 v1과 다르고 계약 버전 리터럴이 v2로 좁혀진다", () => {
    expect(normalizedAuctionV2Schema.meta()?.id).toBe("EatbidIngestionAuctionV2");
    const wrongVersion = { ...v2Fixture, contractVersion: "eatbid.ingestion.auction.v1" };
    expect(() => normalizedAuctionV2Schema.parse(wrongVersion)).toThrow();
  });
});
```

`portable-registry.test.ts`의 첫 케이스에서 `expect(ids).toEqual(["EatbidIngestionAuctionV1"])`를 `["EatbidIngestionAuctionV1", "EatbidIngestionAuctionV2"]`로 바꾸고, 아래 케이스를 더한다.

```ts
  test("계약마다 artifact 파일명이 다르고 v2도 재귀 정렬된 동일 bytes로 생성된다", async () => {
    const { emitPortableSchemas } = await import("./generate-json-schema");
    const directory = await mkdtemp(join(tmpdir(), "eatbid-contracts-v2-"));
    temporaryDirectories.push(directory);

    const paths = await emitPortableSchemas(directory);
    expect(paths.map((path) => path.split(/[\\/]/).at(-1))).toEqual([
      "ingestion-v1.schema.json",
      "ingestion-v2.schema.json",
    ]);
    const document = JSON.parse(await readFile(paths[1]!, "utf8"));
    expect(document.$id).toBe("EatbidIngestionAuctionV2");
    expectRecursivelySorted(document);
  });
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @eatbid/contracts test` → `ingestion/v2/normalized-auction` 모듈 없음으로 실패.

- [ ] **Step 3: 구현**

`values/source-coded-value.ts`:
```ts
/** @module 책임: 외부 코드를 (source_system, code_scheme, code)로 수신하는 관측 value 계약을 소유한다. */
import { z } from "zod";

import { codeSchemeSchema, sourceCodeSchema, sourceSystemSchema } from "../atoms/source-code";

// 왜 label을 같이 싣나. 원본 라벨은 코드의 의미를 사람이 확인할 증거이지 정체성이 아니다. 라벨로
// 조인하거나 라벨을 상태로 승격하지 않는다(AGENTS 2·3). 라벨이 비어 오는 코드가 있으므로 nullable이다.
export const sourceCodedValueSchema = z.strictObject({
  sourceSystem: sourceSystemSchema,
  codeScheme: codeSchemeSchema,
  code: sourceCodeSchema,
  label: z.string().min(1).max(256).nullable(),
}).meta({
  id: "SourceCodedValue",
  description: "One observed external code with its scheme, source system and optional source label.",
});

export type SourceCodedValue = z.infer<typeof sourceCodedValueSchema>;
```

`ingestion/v2/resources/supplier-account.ts`:
```ts
import { z } from "zod";

import { sourceSystemSchema } from "../../../atoms/source-code";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";

// 사업자번호는 대조 키이지 정체성이 아니다(domain-and-data §3.3). SupplierParty로의 승격은 projector가
// 별도 정책으로 하며 정규화 단계는 관측된 계정 코드와 사업자번호를 나란히 보존만 한다.
export const normalizedSupplierAccountSchema = z.strictObject({
  sourceSystem: sourceSystemSchema,
  accountCode: sourceCodedValueSchema,
  businessNumber: sourceCodedValueSchema.nullable(),
}).meta({
  id: "NormalizedSupplierAccount",
  description: "Observed source-scoped supplier account; neither code is an internal identity.",
});

export type NormalizedSupplierAccount = z.infer<typeof normalizedSupplierAccountSchema>;
```

`ingestion/v2/resources/bid-submission.ts`:
```ts
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { instantTextSchema } from "../../../atoms/instant";
import { sourceCodeSchema } from "../../../atoms/source-code";
import { moneyWireSchema } from "../../../values/money";
import { bidRateWireSchema } from "../../../values/rate";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";
import { normalizedSupplierAccountSchema } from "./supplier-account";

export const normalizedBidSubmissionSchema = z.strictObject({
  supplierAccount: normalizedSupplierAccountSchema,
  submittedAt: instantTextSchema.nullable(),
  amount: moneyWireSchema,
  effectiveAmount: moneyWireSchema.nullable(),
  bidRate: bidRateWireSchema,
  rank: nonNegativeCountSchema.nullable(),
  // 2026-09-04 실측에서 BID_STT는 002(낙찰)와 005(낙찰실패) 둘뿐이다. 소스에 "무효"도 "하한미달"도
  // 없으므로 판정을 코드 그대로 싣고 파서가 상태를 만들어내지 않는다.
  sourceStatus: sourceCodedValueSchema,
  // ADR 0029: 이 값의 채움률은 수집 나이의 함수다(약 18개월). 비율의 분모로 쓸 때 성숙도를 병기한다.
  withdrawalFlag: sourceCodedValueSchema.nullable(),
  drawNumbers: z.array(sourceCodeSchema).max(8),
  observedRosterSize: nonNegativeCountSchema.nullable(),
}).meta({
  id: "NormalizedBidSubmission",
  description: "One observed roster row; source judgement stays a code and is never mapped to a derived status.",
});

export type NormalizedBidSubmission = z.infer<typeof normalizedBidSubmissionSchema>;
```

`ingestion/v2/resources/bid-roster.ts`:
```ts
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { normalizedBidSubmissionSchema } from "./bid-submission";

// 상한 2048은 실측 p95 197곳과 최대 명단 규모 사이에 넉넉한 여유를 둔 값이다. 초과는 계약 위반으로
// 격리되어야 하며 조용히 자르지 않는다.
export const normalizedBidRosterSchema = z.strictObject({
  sourceRosterSize: nonNegativeCountSchema.nullable(),
  submissions: z.array(normalizedBidSubmissionSchema).max(2048),
}).meta({
  id: "NormalizedBidRoster",
  description: "Observed roster block; an absent block is an empty roster, not a failure.",
});

export type NormalizedBidRoster = z.infer<typeof normalizedBidRosterSchema>;
```

`ingestion/v2/resources/award-decision.ts`:
```ts
import { z } from "zod";

import { instantTextSchema } from "../../../atoms/instant";
import { moneyWireSchema } from "../../../values/money";
import { bidRateWireSchema } from "../../../values/rate";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";
import { normalizedSupplierAccountSchema } from "./supplier-account";

// 2등은 계산이 아니라 원본 RNK=2 관측값이다. "유효 투찰 중 두 번째"로 다시 세면 하한 판정을 우리가
// 만들게 되고, 그것이 AGENTS 3이 금지하는 해석이다.
export const normalizedAwardDecisionSchema = z.strictObject({
  supplierAccount: normalizedSupplierAccountSchema,
  awardedAt: instantTextSchema.nullable(),
  awardedRate: bidRateWireSchema,
  awardedAmount: moneyWireSchema,
  runnerUpRate: bidRateWireSchema.nullable(),
  sourceStatus: sourceCodedValueSchema,
}).meta({
  id: "NormalizedAwardDecision",
  description: "The single observed award row and the observed runner-up rate by source rank.",
});

export type NormalizedAwardDecision = z.infer<typeof normalizedAwardDecisionSchema>;
```

`ingestion/v2/resources/reserve-price-draw.ts`:
```ts
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { moneyWireSchema } from "../../../values/money";
import { ratioWireSchema } from "../../../values/rate";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";

// 추첨된 후보의 평균이 예정가격과 같다는 것은 999/999로 확인된 소스 불변식이다. 그래도 예정가격은
// ds_info.ELCTRN_BID_PLNPRC 관측값을 싣는다. 여기서 평균을 계산해 채우면 관측과 해석이 섞인다.
export const normalizedReservePriceDrawSchema = z.strictObject({
  candidates: z.array(z.strictObject({
    sequence: nonNegativeCountSchema,
    ratio: ratioWireSchema,
    amount: moneyWireSchema,
    chosen: sourceCodedValueSchema,
  })).max(64),
}).meta({
  id: "NormalizedReservePriceDraw",
  description: "Observed multiple-reserve-price candidates and which of them the source marked chosen.",
});

export type NormalizedReservePriceDraw = z.infer<typeof normalizedReservePriceDrawSchema>;
```

`ingestion/v2/resources/attempt-link.ts`:
```ts
import { z } from "zod";

import { instantTextSchema } from "../../../atoms/instant";
import { externalBidIdSchema } from "../../../atoms/source-code";
import { moneyWireSchema } from "../../../values/money";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";

export const normalizedAttemptLinkSchema = z.strictObject({
  externalBidId: externalBidIdSchema,
  displayBidNumber: z.string().min(1).max(128).nullable(),
  sourceStatus: sourceCodedValueSchema.nullable(),
  bidOpenedFrom: instantTextSchema.nullable(),
  bidClosedAt: instantTextSchema.nullable(),
  baseAmount: moneyWireSchema.nullable(),
  plannedAmount: moneyWireSchema.nullable(),
}).meta({
  id: "NormalizedAttemptLink",
  description: "One member of the observed re-bid chain; ordering is never parsed from the display number suffix.",
});

// 표시 공고번호의 -0/-1/-2 접미사를 차수로 읽지 않는다(AGENTS 4). 사슬은 ds_bidHistory의 원본 id
// 집합과 ds_info.UP_ELCTRN_BID_ID 관계로만 표현하고, 순서 부여는 projector의 결정이다.
export const normalizedAuctionLineageSchema = z.strictObject({
  parentExternalBidId: externalBidIdSchema.nullable(),
  links: z.array(normalizedAttemptLinkSchema).max(64),
}).meta({
  id: "NormalizedAuctionLineage",
  description: "Observed re-bid relations by source identifier only.",
});

export type NormalizedAttemptLink = z.infer<typeof normalizedAttemptLinkSchema>;
export type NormalizedAuctionLineage = z.infer<typeof normalizedAuctionLineageSchema>;
```

`ingestion/v2/resources/auction-terms.ts`:
```ts
import { z } from "zod";

import { bidRateWireSchema } from "../../../values/rate";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";

// 하한율은 화면의 "그날 하한"을 지탱하는 관측값이다(architecture.md §1). 실측 값은 90·88·84.245처럼
// 소수 셋째 자리까지 나오므로 BidRate(3자리)로 받는다.
export const normalizedAuctionTermsSchema = z.strictObject({
  floorRate: bidRateWireSchema.nullable(),
  plannedPriceMethod: sourceCodedValueSchema.nullable(),
  awardMethod: sourceCodedValueSchema.nullable(),
}).meta({
  id: "NormalizedAuctionTerms",
  description: "Observed award terms: floor rate, reserve-price method and award method as source codes.",
});

export type NormalizedAuctionTerms = z.infer<typeof normalizedAuctionTermsSchema>;
```

`ingestion/v2/normalized-auction.ts`:
```ts
import { z } from "zod";

import { normalizedAuctionV1Schema } from "../v1/normalized-auction";
import { normalizedAuctionTermsSchema } from "./resources/auction-terms";
import { normalizedAwardDecisionSchema } from "./resources/award-decision";
import { normalizedBidRosterSchema } from "./resources/bid-roster";
import { normalizedAuctionLineageSchema } from "./resources/attempt-link";
import { normalizedReservePriceDrawSchema } from "./resources/reserve-price-draw";

/**
 * v1 root를 확장한 별도 root다. v1을 고치지 않는 이유는 projection이 저장된 canonical payload를 다시
 * 직렬화해 바이트 동일성을 검사하기 때문이다. v1 root에 필드를 더하면 optional이어도 model_dump가 새 키를
 * 내보내 봉인된 payload가 전부 불일치가 된다(ADR 0025 sealed membership).
 */
export const normalizedAuctionV2Schema = normalizedAuctionV1Schema.safeExtend({
  contractVersion: z.literal("eatbid.ingestion.auction.v2"),
  terms: normalizedAuctionTermsSchema,
  roster: normalizedBidRosterSchema,
  award: normalizedAwardDecisionSchema.nullable(),
  reservePriceDraw: normalizedReservePriceDrawSchema,
  lineage: normalizedAuctionLineageSchema,
}).meta({
  id: "EatbidIngestionAuctionV2",
  description: "Versioned normalized eaT auction interchange contract including roster, draw and lineage blocks.",
});

export type NormalizedAuctionV2 = z.infer<typeof normalizedAuctionV2Schema>;
```

`portable-registry.ts`:
```ts
import { normalizedAuctionV1Schema } from "./ingestion/v1/normalized-auction";
import { normalizedAuctionV2Schema } from "./ingestion/v2/normalized-auction";

// artifact 파일명이 registry 항목의 일부인 이유: emitter가 계약마다 하나의 추적 생성물을 내고, 그
// 대응을 한 곳에서만 정한다. 이름이 코드 두 곳에 흩어지면 drift 검사가 무엇을 비교하는지 흐려진다.
export const portableContracts = Object.freeze([
  { id: "EatbidIngestionAuctionV1", artifact: "ingestion-v1.schema.json", schema: normalizedAuctionV1Schema },
  { id: "EatbidIngestionAuctionV2", artifact: "ingestion-v2.schema.json", schema: normalizedAuctionV2Schema },
] as const);

export type PortableContractId = (typeof portableContracts)[number]["id"];
```

`generate-json-schema.ts`는 계약별 렌더로 일반화하되 기존 export 이름을 유지한다.
```ts
export const generatedDirectory = join(__dirname, "..", "generated");
export const ingestionV1SchemaPath = join(generatedDirectory, "ingestion-v1.schema.json");

function contractById(id: PortableContractId) {
  const ids = portableContracts.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error("Portable contract IDs must be unique");
  const contract = portableContracts.find((entry) => entry.id === id);
  if (contract === undefined) throw new Error(`${id} is not registered`);
  return contract;
}

export function renderPortableSchema(id: PortableContractId): string {
  const contract = contractById(id);
  const schema = z.toJSONSchema(contract.schema, {
    target: "draft-2020-12",
    unrepresentable: "throw",
    cycles: "throw",
  }) as JsonValue;
  const rootSchema = { ...(schema as { [key: string]: JsonValue }), $id: contract.id };
  return `${JSON.stringify(sortJsonKeys(rootSchema), null, 2)}\n`;
}

export const renderIngestionV1Schema = (): string => renderPortableSchema("EatbidIngestionAuctionV1");

export async function emitPortableSchemas(outputDirectory: string): Promise<readonly string[]> {
  await mkdir(outputDirectory, { recursive: true });
  const written: string[] = [];
  for (const entry of portableContracts) {
    const outputPath = join(outputDirectory, entry.artifact);
    await writeFile(outputPath, renderPortableSchema(entry.id), "utf8");
    written.push(outputPath);
  }
  return written;
}

export async function emitIngestionV1Schema(outputDirectory: string): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "ingestion-v1.schema.json");
  await writeFile(outputPath, renderIngestionV1Schema(), "utf8");
  return outputPath;
}
```
`checkPortableSchemas(directory = generatedDirectory)`는 기존 `checkIngestionV1Schema`의 임시 디렉터리 비교 로직을 계약마다 반복한다. `checkIngestionV1Schema(committedPath)`는 그대로 남겨 기존 테스트가 계속 돈다. `main()`은 `--write`에서 `emitPortableSchemas(generatedDirectory)`, `--check`에서 `checkPortableSchemas()`를 부른다.

`src/index.ts`에 `export * from "./values/source-coded-value";`와 `export * from "./ingestion/v2/normalized-auction";`을 더한다.

- [ ] **Step 4: 생성과 통과 확인**

```bash
pnpm contracts:generate
pnpm --filter @eatbid/contracts test
pnpm contracts:check
```
`git diff --stat packages/contracts/generated/ingestion-v1.schema.json`이 **비어야 한다**. v1 artifact가 한 바이트라도 바뀌면 결정 2의 전제가 깨진 것이므로 멈추고 원인을 찾는다.

- [ ] **Step 5: 커밋** — `feat(contracts): 명단·추첨·재입찰 블록을 담는 normalized v2 root 계약을 더한다`

---

### Task 3: v2 Pydantic 모델을 생성하고 생성기를 계약별로 돌린다

**Files:**
- Modify: `apps/dataplane/scripts/generate_contract_models.py`
- Create: `apps/dataplane/src/eatbid/generated/ingestion_v2.py` (생성물)
- Modify: `apps/dataplane/src/eatbid/generated/__init__.py`
- Test: `apps/dataplane/tests/unit/test_contract_generation.py`, `apps/dataplane/tests/unit/test_generated_contract.py`

**Interfaces:**
- Produces: `eatbid.generated.ingestion_v2.EatbidIngestionAuctionV2`와 그 하위 모델(`NormalizedBidRoster`, `NormalizedBidSubmission`, `NormalizedAwardDecision`, `NormalizedReservePriceDraw`, `NormalizedAuctionLineage`, `NormalizedAuctionTerms`, `SourceCodedValue`, `BidRate`, `Ratio`).

- [ ] **Step 1: 실패하는 테스트** — `apps/dataplane/tests/unit/test_contract_generation.py`에 더한다.

```python
def test_계약별_생성물이_각자의_스키마에서_나온다() -> None:
    from eatbid.generated import ingestion_v1, ingestion_v2

    assert ingestion_v1.EatbidIngestionAuctionV1.model_fields.keys() == {
        "contract_version", "identity", "buyer", "location", "schedule", "pricing", "classification",
    }
    v2_fields = ingestion_v2.EatbidIngestionAuctionV2.model_fields
    assert {"terms", "roster", "award", "reserve_price_draw", "lineage"} <= v2_fields.keys()


def test_v2_명단_행은_사정률을_문자열_봉투로만_받는다() -> None:
    from eatbid.generated.ingestion_v2 import BidRate

    assert BidRate(value="90.218", unit="percentage-points").value == "90.218"
    with pytest.raises(ValidationError):
        BidRate(value="91.87", unit="percentage-points")
```

- [ ] **Step 2: 실패 확인** — `uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_contract_generation.py -q`.

- [ ] **Step 3: 구현** — `generate_contract_models.py`를 계약 쌍 목록으로 돌린다.

```python
CONTRACTS: tuple[tuple[Path, Path], ...] = (
    (SCHEMA_ROOT / "ingestion-v1.schema.json", GENERATED_ROOT / "ingestion_v1.py"),
    (SCHEMA_ROOT / "ingestion-v2.schema.json", GENERATED_ROOT / "ingestion_v2.py"),
)
```
`main()`은 쌍마다 기존 임시파일 → 정규화 → 비교/교체 흐름을 그대로 반복하고, `--check`에서 하나라도 drift면 그 경로를 출력한 뒤 1을 반환한다. `_generate_to(path)`는 `input` 인자를 받도록 `_generate_to(schema_path, output_path)`로 바꾼다. 생성기 인자(`--preset practical-py312-20260619`, `--snake-case-field`, `--disable-timestamp`, `--formatters builtin`)는 바꾸지 않는다 — 바꾸면 v1 생성물이 함께 흔들린다.

`generated/__init__.py`:
```python
from eatbid.generated.ingestion_v1 import EatbidIngestionAuctionV1
from eatbid.generated.ingestion_v2 import EatbidIngestionAuctionV2

__all__ = ["EatbidIngestionAuctionV1", "EatbidIngestionAuctionV2"]
```

- [ ] **Step 4: 생성과 통과 확인**

```bash
pnpm contracts:python:generate
pnpm contracts:python:check
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_contract_generation.py apps/dataplane/tests/unit/test_generated_contract.py -q
```
`git diff --stat apps/dataplane/src/eatbid/generated/ingestion_v1.py`가 비어야 한다. v1 생성물이 바뀌면 멈춘다.

- [ ] **Step 5: 커밋** — `feat(data): 계약별 Pydantic 생성기를 돌려 v2 정규화 모델을 만든다`

---

### Task 4: `eat-v2` 검토 계약을 더하고 registry를 parser version 인자로 연다

**Files:**
- Modify: `apps/dataplane/src/eatbid/source/eat/schema_contract.py`
- Modify: `apps/dataplane/src/eatbid/source/eat/registry.py`
- Modify: `apps/dataplane/src/eatbid/source/eat/http_client.py`
- Modify: `apps/dataplane/src/eatbid/pipeline/discover.py`, `apps/dataplane/src/eatbid/pipeline/discovery_persistence.py`, `apps/dataplane/src/eatbid/pipeline/normalize.py`, `apps/dataplane/src/eatbid/pipeline/project.py`
- Test: `apps/dataplane/tests/unit/test_eat_registry.py`, `apps/dataplane/tests/unit/test_project.py`

**Interfaces:**
```python
# registry.py
def require_transport(endpoint: str) -> EatEndpointTransport: ...
def require(endpoint: str, *, parser_version: str) -> EatEndpointContract: ...
```
`EatEndpointTransport`는 origin·path·method·max_response_bytes·payload builder를, `EatEndpointContract`는 transport + `ReviewedSchemaContract` + `record_type`을 갖는다. `record_type`은 parser version에 따라 `auction.v1` / `auction.v2`다.

- [ ] **Step 1: 실패하는 테스트** — `apps/dataplane/tests/unit/test_eat_registry.py`에 더한다.

```python
def test_두_parser_version이_같은_transport와_다른_record_type을_쓴다() -> None:
    v1 = require("bid-detail", parser_version="eat-v1")
    v2 = require("bid-detail", parser_version="eat-v2")

    assert v1.path == v2.path
    assert v1.origin == v2.origin
    assert v1.record_type == "auction.v1"
    assert v2.record_type == "auction.v2"


def test_eat_v2가_v1_필수_부분집합과_fingerprint를_공유한다() -> None:
    v1 = reviewed_schema_contract(source="eat", endpoint="bid-detail", parser_version="eat-v1")
    v2 = reviewed_schema_contract(source="eat", endpoint="bid-detail", parser_version="eat-v2")

    assert v1 is not None and v2 is not None
    # 계약이 주장하는 것은 필수 부분집합의 존재이며 그것은 두 버전에서 같다. 달라진 것은 해석 깊이다.
    assert v1.required_datasets == v2.required_datasets
    assert v1.fingerprint == v2.fingerprint
    assert set(v2.datasets) == {"ds_info", "ds_areaList", "ds_bidList", "ds_pList", "ds_bidHistory"}


def test_모르는_parser_version은_계약을_주지_않는다() -> None:
    with pytest.raises(SourceContractError):
        require("bid-detail", parser_version="eat-v9")
```

`apps/dataplane/tests/unit/test_project.py`에 더한다.
```python
def test_v2_record_type은_아직_projection_계약이_아니라고_typed_실패한다() -> None:
    with pytest.raises(ProjectionContractError, match="auction.v2"):
        build_eat_auction_projection_for_record_type("auction.v2")
```

- [ ] **Step 2: 실패 확인** — `uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_eat_registry.py apps/dataplane/tests/unit/test_project.py -q`.

- [ ] **Step 3: 구현** — `schema_contract.py`

```python
# eat-v2가 아는 명단 column 55개다. 근거는 2026-09-04 레이크 실측(무작위 2,000건, ELCTRN_BID_ID=5669410
# 전수 대조)이다. 파서가 읽지 않는 column까지 두는 이유는 소스가 column을 더하거나 뺄 때 원본 대비로
# 알아채기 위해서다(목록 계약과 같은 이유).
_EAT_V2_BID_LIST_COLUMNS = (
    "BEF_JDG_ID", "BID_CALC_AMT", "BID_DT", "BID_END_DT", "BID_NO", "BID_STT", "BID_STT_NM",
    "BID_UNITPRICE", "BIZ_NO", "CHK", "CNTRCT_UNITPRICE_IPT_YN", "DRAW_NO", "EFT_ALL_AMT", "ETC",
    "ETC_YN", "EVL_SCR", "EXCL_RSN", "FRST_REG_DT", "FRST_RGTR_ID", "INSR_SCRITS_NO", "JUDG_SCORE",
    "LAST_CHGR_ID", "LAST_CHG_DT", "NARA_BIZ_NO", "NEGO_SCORE", "NOTIFY_SEQ", "NOTIFY_STATE_CODE",
    "NOTIFY_STATE_NM", "PRPR_YN", "PRPSAL_ATCHFL_ID", "PRPSAL_EVL_STAT_CD", "QLF_ABL_SCORE",
    "QLF_PRC_SCORE", "QLF_RESULT", "QLF_STT", "QLF_STT_NM", "QLF_TOT_SCORE", "RNK", "RNK2", "RNK3",
    "SAJEONG_PCT", "SCORE_TABLE_SEQ", "SGNNG_ID", "SHIPPER_BRNO", "SHIPPER_CD", "SHIPPER_NM",
    "SKILL_SCORE", "SUCBD_DECISION_MTHD", "SUCBD_DT", "TEMPSAVE_YN", "TOTAL_NUM", "USE_YN",
    "WAIVER_CNT", "WITHDRAWAL_YN", "ELCTRN_BID_ID",
)

_EAT_V2_P_LIST_COLUMNS = (
    "CHC_YN", "CMNM_PLNPRC", "CMNM_PLNPRC_RT", "CMNM_PLNPRC_SN", "ELCTRN_BID_ID",
)

_EAT_V2_BID_HISTORY_COLUMNS = (
    "BID_END_DT", "BID_NM", "BID_NUM_LIMIT_CNT", "BID_NUM_LIMIT_YN", "BID_STRT_DT", "BID_TYPE",
    "BID_TYPE_NM", "DLVRY_END_DT", "DLVRY_PLACE", "DLVRY_STRT_DT", "DLVRY_TIME", "ETC_CN",
    "ETN_BID_ID", "ETN_BID_NO", "ETN_BID_STT", "ETN_BID_STT_NM", "FRST_REG_DT", "FRST_RGTR_ID",
    "LAST_CHGR_ID", "LAST_CHG_DT", "LIMIT_CONDITION", "LIMIT_CONDITION_NM", "PLNPRCE",
    "PLNPRCE_SUCBD_STD", "PLNPRCE_TYPE", "PLNPRCE_TYPE_NM", "PURR_CD", "SOLO_BID_TRT_MTHD",
    "SOLO_BID_TRT_MTHD_NM", "STRPRCE", "STRPRCE_OPEN_YN", "SUCBD_DECISION_MTHD",
    "SUCBD_DECISION_MTHD_NM", "USE_YN",
)

_EAT_V2_BID_DETAIL = ReviewedSchemaContract(
    source="eat",
    endpoint="bid-detail",
    parser_version="eat-v2",
    datasets=MappingProxyType(
        {
            "ds_info": (*_EAT_V1_DETAIL_INFO_COLUMNS, "PLNPRCE_SUCBD_STD", "PLNPRC_TYPE_CD",
                        "PLNPRCE_TYPE_NM", "SUCBD_DECISION_MTHD_NM", "BID_CNT",
                        "UP_ELCTRN_BID_ID", "RBID_YN"),
            "ds_areaList": ("PDLC_CD",),
            "ds_bidList": _EAT_V2_BID_LIST_COLUMNS,
            "ds_pList": _EAT_V2_P_LIST_COLUMNS,
            "ds_bidHistory": _EAT_V2_BID_HISTORY_COLUMNS,
        }
    ),
    # 왜 새 블록을 required에 넣지 않나. fingerprint는 "관측된 required column"으로 계산되므로 명단이
    # 없는 상세(유찰·취소·개찰 전)는 필수 column이 사라져 전부 계약 위반이 된다. 2026-09-04 레이크
    # 무작위 2,000건이 전부 낙찰 공고라 그 모양을 관측한 적이 없으므로 존재를 단언할 근거가 없다.
    # 블록이 있는데 행이 해석되지 않는 경우는 파서가 행 단위로 거부하고 그 관측만 격리한다.
    required=MappingProxyType({"ds_info": ("BID_NM", "ELCTRN_BID_STT_NM", "PURR_CD", "PURR_NM")}),
)
```
`_EAT_V1_DETAIL_INFO_COLUMNS`는 v1 정의에서 tuple을 상수로 뽑아 v1과 v2가 같은 목록을 공유하게 한다. **v1 항목의 값은 바뀌지 않아야 하므로** 뽑아낸 뒤 `_EAT_V1_BID_DETAIL`의 fingerprint가 이전과 같은지 테스트로 고정한다.

목록도 v2 항목을 더한다. 실행 단위가 parser version 하나이므로(`discover_release`의 검사) v2 실행이 목록 계약을 못 찾으면 안 된다.
```python
_EAT_V2_BID_LIST_PAGE = replace(_EAT_V1_BID_LIST, parser_version="eat-v2")
```
`REVIEWED_EAT_SCHEMA_CONTRACTS`에 두 항목을 더한다.

`registry.py`는 transport와 schema를 나눈다.
```python
@dataclass(frozen=True, slots=True)
class EatEndpointTransport:
    """endpoint의 전송 경계다. parser version과 무관하며 응답 해석 방법을 모른다."""
    endpoint: str
    origin: str
    path: str
    method: str
    max_response_bytes: int
    _payload_builder: PayloadBuilder = field(repr=False, compare=False)
    _page_params_builder: PageParamsBuilder | None = field(default=None, repr=False, compare=False)

_RECORD_TYPES = MappingProxyType({
    ("bid-list", "eat-v1"): "auction-discovery.v1",
    ("bid-list", "eat-v2"): "auction-discovery.v1",
    ("bid-detail", "eat-v1"): "auction.v1",
    ("bid-detail", "eat-v2"): "auction.v2",
})

def require(endpoint: str, *, parser_version: str) -> EatEndpointContract:
    transport = require_transport(endpoint)
    schema = reviewed_schema_contract(source="eat", endpoint=endpoint, parser_version=parser_version)
    record_type = _RECORD_TYPES.get((endpoint, parser_version))
    if schema is None or record_type is None:
        raise SourceContractError(
            f"eaT unknown-parser-version [endpoint={endpoint} parser_version={parser_version}]"
        )
    return EatEndpointContract(transport=transport, schema_contract=schema, record_type=record_type)
```
목록 record_type이 두 버전에서 같은 이유는 목록 정규화 결과가 v2에서 바뀌지 않기 때문이다. 이유를 한국어 주석으로 남긴다.

호출부:
- `http_client.py:126`은 전송만 필요하므로 `require_transport(request.endpoint)`로 바꾼다.
- `discover.py:119`, `discover.py:243-244`, `discovery_persistence.py:52`, `:91`은 `plan.parser_version`을 넘긴다. `discovery_persistence`의 두 메서드는 이미 `plan`을 받거나 받도록 인자를 더한다.
- `pipeline/normalize.py`의 `record_type="auction.v1"` 하드코딩을 `require("bid-detail", parser_version=parser_version).record_type`으로 바꾼다.
- `pipeline/project.py`는 v2 record_type을 만나면 typed 실패를 낸다.

```python
# EAT-43이 core 테이블과 projector를 만들기 전까지 v2 record는 발행 대상이 아니다. 조용히 v1로
# 오해석되면 명단 없는 공고로 core에 들어가므로 여기서 명시적으로 닫는다.
_PROJECTABLE_RECORD_TYPES = frozenset({"auction.v1"})

def _require_projectable(record_type: str) -> None:
    if record_type not in _PROJECTABLE_RECORD_TYPES:
        raise ProjectionContractError(
            f"normalized record type is not projectable yet [record_type={record_type}]"
        )
```

- [ ] **Step 4: 통과 확인**

```bash
uv run --project apps/dataplane pytest apps/dataplane/tests -q
pnpm dataplane:lint
pnpm dataplane:typecheck
```
기존 테스트 중 `require("bid-list")`처럼 인자 없이 부르는 곳이 있으면 전부 `parser_version="eat-v1"`을 명시한다. 기본값을 만들지 않는다 — 기본값은 어떤 계약으로 읽었는지를 호출부에서 지운다.

- [ ] **Step 5: 커밋** — `feat(source): eat-v2 상세 계약을 더하고 registry를 parser version으로 연다`

---

### Task 5: 세 블록을 해석하는 `roster.py`와 v2 정규화 경로

**Files:**
- Create: `apps/dataplane/src/eatbid/source/eat/roster.py`
- Modify: `apps/dataplane/src/eatbid/source/eat/wire_values.py`
- Modify: `apps/dataplane/src/eatbid/source/eat/normalize.py`
- Test: `apps/dataplane/tests/unit/test_eat_roster.py`, `apps/dataplane/tests/unit/test_eat_normalize_v2.py`

**Interfaces:**
```python
# roster.py
def parse_bid_roster(parsed: ParsedNexacro) -> NormalizedBidRoster: ...
def parse_award_decision(roster: NormalizedBidRoster, info: Mapping[str, str]) -> NormalizedAwardDecision | None: ...
def parse_reserve_price_draw(parsed: ParsedNexacro) -> NormalizedReservePriceDraw: ...
def parse_lineage(parsed: ParsedNexacro, info: Mapping[str, str]) -> NormalizedAuctionLineage: ...
def parse_auction_terms(info: Mapping[str, str]) -> NormalizedAuctionTerms: ...

# wire_values.py
def optional_bid_rate(row: Mapping[str, str], field: str) -> BidRate | None: ...
def optional_ratio(row: Mapping[str, str], field: str) -> Ratio | None: ...
def optional_source_coded_value(row, code_field, *, code_scheme, label_field=None) -> SourceCodedValue | None: ...
```

- [ ] **Step 1: 실패하는 테스트** — `apps/dataplane/tests/unit/test_eat_roster.py`

```python
from __future__ import annotations

from pathlib import Path

import pytest

from eatbid.source.eat.roster import (
    parse_auction_terms,
    parse_award_decision,
    parse_bid_roster,
    parse_lineage,
    parse_reserve_price_draw,
)
from eatbid.source.eat.xml import parse_nexacro

FIXTURES = Path(__file__).parents[1] / "fixtures" / "eat"
NS = "http://www.nexacroplatform.com/platform/dataset"


def _parsed(name: str):
    return parse_nexacro((FIXTURES / name).read_bytes(), require_ds_info=True)


def _roster_xml(*rows: str) -> bytes:
    body = "".join(rows)
    return (
        f'<Root xmlns="{NS}"><Dataset id="ds_info"><Rows><Row>'
        f'<Col id="BID_NM">t</Col><Col id="ELCTRN_BID_STT_NM">낙찰</Col>'
        f'<Col id="PURR_CD">1</Col><Col id="PURR_NM">n</Col>'
        f'</Row></Rows></Dataset>'
        f'<Dataset id="ds_bidList"><Rows>{body}</Rows></Dataset></Root>'
    ).encode()


def _row(**cols: str) -> str:
    return "<Row>" + "".join(f'<Col id="{k}">{v}</Col>' for k, v in cols.items()) + "</Row>"


def test_명단_행이_사정률과_금액과_판정_코드를_그대로_싣는다() -> None:
    roster = parse_bid_roster(_parsed("bid-detail-roster.xml"))

    first = roster.submissions[0]
    assert first.bid_rate.value == "90.218"
    assert first.amount.amount == "6101000.00"
    assert first.source_status.code == "002"
    assert first.source_status.code_scheme == "eat:BID_STT"
    assert first.source_status.label == "낙찰"
    assert first.supplier_account.account_code.code_scheme == "eat:SHIPPER_CD"
    assert first.draw_numbers == ["7", "3"]


def test_사정률의_짧은_소수를_잘라내지_않고_세_자리로_맞춘다() -> None:
    roster = parse_bid_roster(parse_nexacro(_roster_xml(_row(
        SAJEONG_PCT="91.87", BID_CALC_AMT="6212700", BID_STT="005", BID_STT_NM="낙찰실패",
        SHIPPER_CD="200492", BIZ_NO="1000000000", RNK="83", TOTAL_NUM="85", WITHDRAWAL_YN="Y",
    )), require_ds_info=True))

    assert roster.submissions[0].bid_rate.value == "91.870"


def test_사정률이_없는_명단_행은_해석하지_않고_거부한다() -> None:
    with pytest.raises(ValueError, match="SAJEONG_PCT"):
        parse_bid_roster(parse_nexacro(_roster_xml(_row(
            BID_CALC_AMT="6212700", BID_STT="005", SHIPPER_CD="200492",
        )), require_ds_info=True))


def test_명단_블록이_없으면_빈_명단이지_실패가_아니다() -> None:
    roster = parse_bid_roster(_parsed("bid-detail-no-roster.xml"))

    assert roster.submissions == []
    assert roster.sourceRosterSize is None or roster.source_roster_size is None


def test_낙찰은_원본_판정_코드로_고르고_이등은_원본_순위로_고른다() -> None:
    parsed = _parsed("bid-detail-roster.xml")
    roster = parse_bid_roster(parsed)
    award = parse_award_decision(roster, parsed.datasets["ds_info"][0])

    assert award is not None
    assert award.awarded_rate.value == "90.218"
    assert award.runner_up_rate is not None and award.runner_up_rate.value == "90.382"


def test_낙찰_판정이_둘_이상이면_해석하지_않고_거부한다() -> None:
    parsed = parse_nexacro(_roster_xml(
        _row(SAJEONG_PCT="90.100", BID_CALC_AMT="1000", BID_STT="002", SHIPPER_CD="1", RNK="1"),
        _row(SAJEONG_PCT="90.200", BID_CALC_AMT="2000", BID_STT="002", SHIPPER_CD="2", RNK="2"),
    ), require_ds_info=True)
    roster = parse_bid_roster(parsed)

    with pytest.raises(ValueError, match="single award"):
        parse_award_decision(roster, parsed.datasets["ds_info"][0])


def test_추첨_후보_넷의_평균이_관측된_예정가격과_같다() -> None:
    from decimal import Decimal, ROUND_HALF_UP

    parsed = _parsed("bid-detail-roster.xml")
    draw = parse_reserve_price_draw(parsed)
    chosen = [Decimal(c.amount.amount) for c in draw.candidates if c.chosen.code == "Y"]

    assert len(chosen) == 4
    average = (sum(chosen) / len(chosen)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    assert average == Decimal(parsed.datasets["ds_info"][0]["ELCTRN_BID_PLNPRC"])


def test_재입찰_사슬은_원본_id로만_잇고_공고번호_접미사를_읽지_않는다() -> None:
    parsed = _parsed("bid-detail-rebid.xml")
    lineage = parse_lineage(parsed, parsed.datasets["ds_info"][0])

    assert lineage.parent_external_bid_id == "5306354"
    assert [link.external_bid_id for link in lineage.links] == ["5306521", "5306354", "5301243"]
    assert all(not hasattr(link, "round_number") for link in lineage.links)


def test_하한율은_소수_세_자리_비율로_관측된다() -> None:
    terms = parse_auction_terms({"PLNPRCE_SUCBD_STD": "90", "PLNPRC_TYPE_CD": "002",
                                 "PLNPRCE_TYPE_NM": "복수예정가격"})

    assert terms.floor_rate is not None and terms.floor_rate.value == "90.000"
    assert terms.planned_price_method is not None
    assert terms.planned_price_method.code == "002"
```

`apps/dataplane/tests/unit/test_eat_normalize_v2.py`

```python
def test_v2_정규화가_명단과_추첨과_하한율을_한_record로_묶는다() -> None:
    payload = (FIXTURES / "bid-detail-roster.xml").read_bytes()

    detail = normalize_bid_detail_payload(payload, external_bid_id="5669410", parser_version="eat-v2")

    assert detail.record.contract_version == "eatbid.ingestion.auction.v2"
    assert len(detail.record.roster.submissions) == 8
    assert detail.record.award is not None
    assert detail.record.terms.floor_rate.value == "90.000"
    assert len(detail.record.reserve_price_draw.candidates) == 15


def test_v1과_v2가_같은_원본에서_서로_다른_계약_버전을_낸다() -> None:
    payload = (FIXTURES / "bid-detail-roster.xml").read_bytes()

    v1 = normalize_bid_detail_payload(payload, external_bid_id="5669410", parser_version="eat-v1")
    v2 = normalize_bid_detail_payload(payload, external_bid_id="5669410", parser_version="eat-v2")

    assert v1.record.contract_version == "eatbid.ingestion.auction.v1"
    assert v1.schema_fingerprint == v2.schema_fingerprint
    assert not hasattr(v1.record, "roster")


def test_블록이_없는_상세도_v2로_정규화되고_격리되지_않는다() -> None:
    payload = (FIXTURES / "bid-detail-no-roster.xml").read_bytes()

    detail = normalize_bid_detail_payload(payload, external_bid_id="1", parser_version="eat-v2")

    assert detail.record.roster.submissions == []
    assert detail.record.award is None
    assert detail.record.lineage.links == []


def test_명단_행이_깨지면_그_관측만_격리_대상_오류가_된다() -> None:
    broken = (FIXTURES / "bid-detail-roster.xml").read_text(encoding="utf-8").replace(
        '<Col id="SAJEONG_PCT">90.218</Col>', '<Col id="SAJEONG_PCT">구십</Col>', 1
    ).encode()

    with pytest.raises(EatDetailValidationError) as error:
        normalize_bid_detail_payload(broken, external_bid_id="5669410", parser_version="eat-v2")
    assert error.value.schema_fingerprint is not None


def test_canonical_payload는_v2_record도_정렬된_바이트로_직렬화한다() -> None:
    payload = (FIXTURES / "bid-detail-roster.xml").read_bytes()
    record = normalize_bid_detail(payload, external_bid_id="5669410", parser_version="eat-v2")

    first = canonical_payload(record)
    assert canonical_payload(record) == first
    assert b'"contractVersion":"eatbid.ingestion.auction.v2"' in first
```

- [ ] **Step 2: 실패 확인** — `uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_eat_roster.py apps/dataplane/tests/unit/test_eat_normalize_v2.py -q`.

- [ ] **Step 3: `wire_values.py` 확장**

```python
_BID_RATE_SCALE = Decimal("0.001")
_RATIO_SCALE = Decimal("0.000001")

# eaT BID_DT는 다른 시각 필드와 달리 하이픈·공백·콜론이 있는 19자다(2026-09-04 실측). 폭이 고정이라
# 모호하지 않으므로 별도 검토된 wire 모양으로 선언한다. 검증기를 느슨하게 만드는 것이 아니다.
_SOURCE_TIME_WIRE_SHAPES["%Y-%m-%d %H:%M:%S"] = (
    (re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}"), 19, "%Y-%m-%d %H:%M:%S"),
)


def optional_bid_rate(row: Mapping[str, str], field: str) -> BidRate | None:
    """사정률·하한율을 소수 셋째 자리 percentage-points로 읽는다.

    왜 quantize하나. 소스는 90.218·91.87·90처럼 자릿수를 섞어 보낸다(실측 11,912행에서 3자리 89%,
    2자리 10%, 1자리·0자리 소수). 계약이 정한 정밀도는 셋째 자리이고 그보다 짧은 값은 손실 없이
    늘어난다. 셋째 자리보다 정밀한 값은 반올림하지 않고 거부한다 — 그건 계약 밖의 관측이다.
    """
    value = optional_text(row, field)
    if value is None:
        return None
    rate = Decimal(value)
    exponent = rate.as_tuple().exponent
    if (
        not rate.is_finite()
        or rate.is_signed()
        or rate > 100
        or not isinstance(exponent, int)
        or exponent < -3
    ):
        raise ValueError(f"{field} must be a bid rate between 0 and 100 at scale 3")
    return BidRate(value=format(rate.quantize(_BID_RATE_SCALE), "f"), unit="percentage-points")
```
`optional_ratio`는 같은 모양으로 `_RATIO_SCALE`과 상한 1을 쓴다. `optional_source_coded_value`는 `code_field`가 비면 `None`, 있으면 `SourceCodedValue(source_system="eat", code_scheme=code_scheme, code=..., label=optional_text(row, label_field))`를 낸다.

- [ ] **Step 4: `roster.py` 구현**

```python
"""모듈 책임: eaT 상세의 명단·추첨 예비가격·재입찰 사슬 블록을 관측된 값 그대로 정규화 모델로 옮긴다."""

from __future__ import annotations

from collections.abc import Mapping

from eatbid.generated.ingestion_v2 import (
    NormalizedAttemptLink,
    NormalizedAuctionLineage,
    NormalizedAuctionTerms,
    NormalizedAwardDecision,
    NormalizedBidRoster,
    NormalizedBidSubmission,
    NormalizedReservePriceDraw,
    NormalizedSupplierAccount,
)
from eatbid.source.eat.wire_values import (
    optional_bid_rate,
    optional_instant_text,
    optional_money,
    optional_ratio,
    optional_source_coded_value,
    optional_text,
    required_text,
)
from eatbid.source.eat.xml import ParsedNexacro

_BID_LIST = "ds_bidList"
_P_LIST = "ds_pList"
_BID_HISTORY = "ds_bidHistory"
# 낙찰 판정 코드. 2026-09-04 실측 300건에서 회차당 정확히 한 행이 이 값을 갖는다. 이름이 아니라
# 코드로 고르는 이유는 라벨이 표시 문자열이라 언제든 바뀔 수 있기 때문이다(AGENTS 2).
_AWARDED_STATUS_CODE = "002"
_MAX_DRAW_NUMBERS = 8


def parse_bid_roster(parsed: ParsedNexacro) -> NormalizedBidRoster:
    """명단 블록을 읽는다. 블록이 없으면 빈 명단이며 그것은 실패가 아니다(AGENTS 3)."""
    info = parsed.datasets["ds_info"][0]
    rows = parsed.datasets.get(_BID_LIST, ())
    return NormalizedBidRoster(
        source_roster_size=_optional_count(info, "BID_CNT"),
        submissions=[_submission(row) for row in rows],
    )


def _submission(row: Mapping[str, str]) -> NormalizedBidSubmission:
    bid_rate = optional_bid_rate(row, "SAJEONG_PCT")
    if bid_rate is None:
        raise ValueError("SAJEONG_PCT is required on an observed roster row")
    amount = optional_money(row, "BID_CALC_AMT")
    if amount is None:
        raise ValueError("BID_CALC_AMT is required on an observed roster row")
    status = optional_source_coded_value(
        row, "BID_STT", code_scheme="eat:BID_STT", label_field="BID_STT_NM"
    )
    if status is None:
        raise ValueError("BID_STT is required on an observed roster row")
    return NormalizedBidSubmission(
        supplier_account=_supplier_account(row),
        submitted_at=optional_instant_text(row, "BID_DT", "%Y-%m-%d %H:%M:%S"),
        amount=amount,
        effective_amount=optional_money(row, "EFT_ALL_AMT"),
        bid_rate=bid_rate,
        rank=_optional_count(row, "RNK"),
        source_status=status,
        withdrawal_flag=optional_source_coded_value(
            row, "WITHDRAWAL_YN", code_scheme="eat:WITHDRAWAL_YN"
        ),
        draw_numbers=_draw_numbers(row),
        observed_roster_size=_optional_count(row, "TOTAL_NUM"),
    )


def _supplier_account(row: Mapping[str, str]) -> NormalizedSupplierAccount:
    account = optional_source_coded_value(
        row, "SHIPPER_CD", code_scheme="eat:SHIPPER_CD", label_field="SHIPPER_NM"
    )
    if account is None:
        raise ValueError("SHIPPER_CD is required on an observed roster row")
    # NARA_BIZ_NO는 사업자번호가 아니라 "부정당업자가 아닙니다." 같은 문장이다(ADR 0029). 읽지 않는다.
    return NormalizedSupplierAccount(
        source_system="eat",
        account_code=account,
        business_number=optional_source_coded_value(row, "BIZ_NO", code_scheme="eat:BIZ_NO"),
    )


def _draw_numbers(row: Mapping[str, str]) -> list[str]:
    """DRAW_NO는 한 업체가 고른 예비가격 번호 둘을 ', '로 이어 보낸다(실측 '7, 3')."""
    value = optional_text(row, "DRAW_NO")
    if value is None:
        return []
    numbers = [part.strip() for part in value.split(",")]
    if any(not part.isdigit() for part in numbers) or len(numbers) > _MAX_DRAW_NUMBERS:
        raise ValueError("DRAW_NO must be a bounded comma separated list of decimal draw numbers")
    return numbers


def parse_award_decision(
    roster: NormalizedBidRoster, info: Mapping[str, str]
) -> NormalizedAwardDecision | None:
    awarded = [row for row in roster.submissions if row.source_status.code == _AWARDED_STATUS_CODE]
    if not awarded:
        return None
    if len(awarded) > 1:
        raise ValueError("an observed roster must carry a single award row")
    # 2등은 원본 RNK=2 관측값이다. "유효 투찰 중 두 번째"로 다시 세면 하한 판정을 우리가 만들게 된다.
    runner_up = next((row for row in roster.submissions if row.rank == 2), None)
    row = awarded[0]
    return NormalizedAwardDecision(
        supplier_account=row.supplier_account,
        awarded_at=optional_instant_text(_award_row(row), "SUCBD_DT", "%Y%m%d"),
        awarded_rate=row.bid_rate,
        awarded_amount=row.amount,
        runner_up_rate=runner_up.bid_rate if runner_up is not None else None,
        source_status=row.source_status,
    )
```
`_award_row`는 원본 행 mapping을 다시 필요로 하므로, 실제 구현은 `_submission`이 `(NormalizedBidSubmission, Mapping[str, str])` 쌍을 돌려주거나 `parse_award_decision`이 `parsed`를 받도록 시그니처를 정한다. **구현자가 하나를 고르고 테스트 시그니처를 그에 맞춘다.** 권장은 `parse_award_decision(parsed: ParsedNexacro, roster: NormalizedBidRoster)`로 원본 행에 계속 접근할 수 있게 하는 것이다.

`parse_reserve_price_draw`는 `ds_pList`의 `CMNM_PLNPRC_SN`(count)·`CMNM_PLNPRC_RT`(ratio)·`CMNM_PLNPRC`(money)·`CHC_YN`(coded value)를 그대로 옮기고 `sequence` 중복을 거부한다. `parse_lineage`는 `ds_bidHistory` 행을 원본 순서대로 담고 `info["UP_ELCTRN_BID_ID"]`를 `parent_external_bid_id`로 둔다. `ETN_BID_NO`는 표시값으로만 싣는다.

- [ ] **Step 5: `normalize.py` 분기**

`_BID_DETAIL_SCHEMA` 모듈 상수를 parser version별 mapping으로 바꾸고, `normalize_bid_detail_payload`가 `parser_version`으로 계약과 조립 함수를 고른다.
```python
_DETAIL_SCHEMAS = MappingProxyType({
    version: _require_detail_schema(version) for version in ("eat-v1", "eat-v2")
})

def _build_v2(parsed: ParsedNexacro, info: Mapping[str, str], external_bid_id: str):
    base = _build_v1_fields(info, parsed, external_bid_id)
    roster = parse_bid_roster(parsed)
    return EatbidIngestionAuctionV2(
        **base,
        contract_version="eatbid.ingestion.auction.v2",
        terms=parse_auction_terms(info),
        roster=roster,
        award=parse_award_decision(parsed, roster),
        reserve_price_draw=parse_reserve_price_draw(parsed),
        lineage=parse_lineage(parsed, info),
    )
```
`_build_v1_fields`는 지금 `EatbidIngestionAuctionV1(...)` 인자로 쓰이는 dict를 만드는 함수로 추출한다. v1 경로는 그 dict로 v1 모델을, v2 경로는 같은 dict에 v2 필드를 얹는다. **v1 record의 필드 값이 하나도 바뀌지 않아야 한다** — Task 5 완료 후 `test_eat_normalize.py`가 손대지 않은 채 통과해야 한다.

`_contract_fingerprint`는 `_DETAIL_SCHEMAS[parser_version].required_datasets`를 쓰도록 인자를 받는다. 두 버전의 required가 같으므로 값은 같지만, 계약을 어디서 읽는지는 명시적이어야 한다.

`canonical_payload`의 타입 가드를 `(EatbidIngestionAuctionV1, EatbidIngestionAuctionV2)`로 넓힌다.

- [ ] **Step 6: 통과 확인**

```bash
uv run --project apps/dataplane pytest apps/dataplane/tests -q
pnpm dataplane:lint
pnpm dataplane:typecheck
pnpm quality:check
```

- [ ] **Step 7: 커밋** — `feat(source): 명단·추첨 예비가격·재입찰 사슬을 eat-v2 정규화 모델로 읽는다`

---

### Task 6: 전수 재정규화 리포트와 남산초 대조

**Files:**
- Create: `apps/dataplane/scripts/renormalize_lake_report.py`
- Create: `apps/dataplane/tests/integration/test_lake_renormalization.py`
- Create: `docs/evidence/normalization/2026-09-04-eat-v2-renormalization.md` (스크립트 산출물을 커밋)
- Modify: `apps/dataplane/pyproject.toml` (`markers = ["lake: 로컬 원본 레이크가 있을 때만 도는 테스트"]`)

**Interfaces:**
```
uv run --project apps/dataplane python apps/dataplane/scripts/renormalize_lake_report.py \
  --lake F:/Project/eat-bid/data/raw/internal \
  --output docs/evidence/normalization/2026-09-04-eat-v2-renormalization.md \
  --calc-version eat-v2-r1
```
`--limit N`으로 표본만 돌 수 있고, `--organization-code 153045`로 코호트를 좁힐 수 있다.

리포트가 담는 것(AGENTS 7: 표본 수·코호트·기간·계산 버전·산출 시각을 전부 남긴다):

| 절 | 내용 |
| -- | -- |
| 실행 | 레이크 경로, 파일 수, 계산 버전, 산출 시각(UTC), 파서 버전 |
| 격리 | 격리 건수·격리율·사유별 상위 20(예외 클래스 + 메시지 첫 80자) |
| 블록 보유율 | `ds_bidList` / `ds_pList` / `ds_bidHistory` 보유 건수와 비율 |
| 명단 규모 | 평균·중앙·p95·최대, 표본 수 |
| 무효 | `bid_rate < terms.floor_rate` 행 수와 비율, 하한율별 분해 |
| 1·2등 격차 | 하한율 이상 투찰 중 최저 둘의 차 중앙값·사분위, 표본 회차 수 |
| 명단 규모별 낙찰률 | 3~9 / 10~29 / 30~59 / 60~99 / 100+ 구간 중앙값 |
| 불변식 | 회차당 낙찰 행 1개 위반 수, 낙찰 행이 하한 미만인 수, 추첨 넷 평균 ≠ 예정가격 수 |
| 남산초 | `PURR_CD=153045` 회차 수와 `namsan_rounds.json` 대조 결과 |

⚠ 무효와 격차는 **리포트의 계산**이지 정규화 모델의 필드가 아니다. `roster.py`는 이 값을 만들지 않는다. 리포트가 관측값에서 다시 계산하고 계산 버전을 남긴다.

- [ ] **Step 1: 실패하는 테스트** — `apps/dataplane/tests/integration/test_lake_renormalization.py`

```python
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from eatbid.scripts.renormalize_lake_report import build_report, summarize_rounds

LAKE = Path(os.environ.get("EATBID_RAW_LAKE", "F:/Project/eat-bid/data/raw/internal"))
ROUNDS = Path(__file__).parents[3] / "docs" / "product" / "decision-screen-v2" / "design-generators" / "namsan_rounds.json"

pytestmark = pytest.mark.lake


@pytest.fixture(scope="module")
def _lake() -> Path:
    if not LAKE.is_dir():
        pytest.skip("로컬 원본 레이크가 없다")
    return LAKE


def test_남산초_회차의_낙찰률과_명단_수가_조사값과_일치한다(_lake: Path) -> None:
    expected = {row["bidId"]: row for row in json.loads(ROUNDS.read_text(encoding="utf-8"))}

    observed = summarize_rounds(_lake, external_bid_ids=tuple(expected))

    assert set(observed) == set(expected)
    for bid_id, round_ in expected.items():
        assert observed[bid_id].award_rate == f"{round_['winRate']:.3f}"
        assert observed[bid_id].roster_size == round_["nBids"]


def test_남산초_회차_전부가_격리되지_않고_정규화된다(_lake: Path) -> None:
    expected = json.loads(ROUNDS.read_text(encoding="utf-8"))

    report = build_report(_lake, external_bid_ids=tuple(r["bidId"] for r in expected),
                          calc_version="test")

    assert report.quarantined == 0
    assert report.normalized == len(expected)


def test_불변식_위반이_리포트에_수로_남는다(_lake: Path) -> None:
    report = build_report(_lake, limit=2000, calc_version="test")

    assert report.invariants["multiple_award_rows"] == 0
    assert report.invariants["award_below_floor"] == 0
    assert report.invariants["draw_average_mismatch"] == 0
    assert report.sample_count == report.normalized + report.quarantined
```

- [ ] **Step 2: 실패 확인** — `uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_lake_renormalization.py -q -m lake`.

- [ ] **Step 3: 구현** — 스크립트는 `gzip`으로 각 `<shard>/<bidId>.xml.gz`를 읽어 `normalize_bid_detail_payload(..., parser_version="eat-v2")`를 부르고, `NexacroParseError`/`EatDetailValidationError`를 사유별로 센다. 원본은 읽기만 한다. `--output`은 마크다운 표만 쓰고 원본 payload를 옮겨 담지 않는다.

⚠ 리포트가 실제 사업자번호나 업체명을 문서로 내보내지 않게 한다. 집계·분포·개수만 쓴다. 남산초 대조도 `bidId`·낙찰률·명단 수만 비교한다.

- [ ] **Step 4: 전수 실행과 문서 커밋**

```bash
uv run --project apps/dataplane python apps/dataplane/scripts/renormalize_lake_report.py --lake F:/Project/eat-bid/data/raw/internal --output docs/evidence/normalization/2026-09-04-eat-v2-renormalization.md --calc-version eat-v2-r1
```
233,382 파일이므로 수십 분이 걸린다. 백그라운드로 돌리고 결과를 확인한 뒤 커밋한다. 리포트의 무효 비율과 격차 중앙값이 문서의 26,000 조사값(41.3%, 0.061%p)과 다르면 **숫자를 맞추려 파서를 고치지 않는다.** 코호트 차이(표본 기간·명단 규모 분포)를 리포트에 적고, 26,000 조사와 같은 코호트로 좁힌 값을 별도 절로 낸다.

- [ ] **Step 5: 통과 확인**

```bash
uv run --project apps/dataplane pytest apps/dataplane/tests -q
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_lake_renormalization.py -q -m lake
```

- [ ] **Step 6: 커밋** — `test(data): 전수 재정규화 리포트와 남산초 회차 대조를 더한다`

---

### Task 7: 문서와 계약 경계를 같은 변경에서 갱신한다

**Files:**
- Modify: `docs/product/decision-screen-v2/architecture.md` (§1 "흐름·과거 회차"와 "그날 하한" 행의 채움률 `미독` → 읽는 계약과 그 한계)
- Modify: `docs/architecture/domain-and-data.md` §3.4 (원본 판정에 "무효"가 없다는 사실과 하한 비교가 파생 계산이라는 경계)
- Modify: `docs/adr/0029-eat-v2-bid-list-contract.md` (Consequences에 후속 결정 세 줄 추가: fingerprint를 required 부분집합으로 계산하므로 v1·v2 fingerprint가 같다는 것, 새 블록을 required에 넣지 않은 이유, v2 record가 아직 projectable하지 않다는 것)
- Modify: `docs/evidence/source-boundary/2026-09-03-bid-roster-in-detail.md` (Task 1에서 시작한 §6 갱신 마무리: `ds_pList`가 복수예정가격이고 추첨 넷의 평균이 예정가격이며, `ds_bidHistory`가 재입찰 사슬이고, `SAJEONG_PCT`의 분모가 예정가격이라는 확인)
- Modify: `docs/architecture/time-and-value-contracts.md` (`BidRate`·`Ratio`·`SourceCodedValue`가 ingestion v2에서 쓰이는 지점)

- [ ] **Step 1: 사실 확인** — 문서에 넣을 숫자는 Task 6 리포트에서 그대로 가져온다. 이 계획의 실측 표를 다시 옮겨 적지 않는다. 리포트가 권위다.
- [ ] **Step 2: 갱신** — `미독`을 지울 때 무엇이 여전히 미해결인지 같이 적는다. 최소한 세 가지가 남는다. 유찰·취소·개찰 전 상세의 모양을 관측한 적이 없다는 것, `WITHDRAWAL_YN`의 채움률이 수집 나이의 함수라는 것, `ds_bidHistory` 보유율이 2~3%라 재입찰 사슬이 대부분 `unknown`이라는 것.
- [ ] **Step 3: 통과 확인**

```bash
pnpm architecture:check
```

- [ ] **Step 4: 커밋** — `docs(data): eat-v2가 읽는 블록과 남은 미관측 경계를 기록한다`

---

## 전체 검증

Task 7까지 끝난 뒤 worktree 루트에서 한 번에 돌린다.

```bash
pnpm contracts:check
pnpm contracts:python:check
uv run --project apps/dataplane pytest apps/dataplane/tests -q
pnpm dataplane:lint
pnpm dataplane:typecheck
pnpm --filter @eatbid/contracts test
pnpm architecture:check
```

`pnpm architecture:check`는 `quality:check`(테스트명 한글·모듈 책임 주석)와 `check-python-semantic-values.py`(rule 17 Python gate)와 `contracts:check`·`contracts:python:check`를 모두 포함한다. 이것 하나가 초록이면 계약·의미값·주석 gate가 다 지나간 것이다.

---

## 자기 검토

### Linear Acceptance 대응

| Acceptance | 어디서 만족하나 | 무엇이 증거인가 |
| -- | -- | -- |
| `pnpm contracts:python:check` check mode 통과, fingerprint drift 없음 | Task 2(Zod → JSON Schema), Task 3(JSON Schema → Pydantic), Task 4(wire fingerprint) | Task 2 Step 4와 Task 3 Step 4의 `git diff --stat`이 v1 생성물에서 비어야 한다. Task 4의 `test_eat_v2가_v1_필수_부분집합과_fingerprint를_공유한다`가 v1 fingerprint 불변을 고정한다 |
| 233,382 raw 전수 재정규화에서 격리율과 실패 사유가 문서에 남는다 | Task 6 | `docs/evidence/normalization/2026-09-04-eat-v2-renormalization.md`의 격리 절(건수·비율·사유별 상위 20) |
| 26,000 조사값 재현 | Task 6 | 리포트의 무효 비율·1·2등 격차·명단 규모별 낙찰률 절. 코호트를 명시하고 26,000 조사와 같은 코호트로 좁힌 값을 별도로 낸다 |

### 범위 대조

- EAT-42 본문 "reviewed source parser" → Task 4·5. "normalized model에 `bid_submission`·`award_decision`·`reserve_price_draw`·`attempt_link` 추가" → Task 2의 다섯 resource(`bid-roster`가 `bid_submission[]`를 담고 `lineage`가 `attempt_link[]`를 담는다). "파싱 실패는 격리" → Task 5의 `test_명단_행이_깨지면_그_관측만_격리_대상_오류가_된다`. "남산초 92회차·26,000 조사값 대조" → Task 6.
- Non-goal 준수: core 테이블·projection writer·mart를 만들지 않는다. Task 4가 v2 record_type을 projection에서 typed 실패로 닫아 EAT-43 전까지 core로 새지 않게 한다.

### 이름 일관성

- `parse_bid_roster` / `parse_award_decision` / `parse_reserve_price_draw` / `parse_lineage` / `parse_auction_terms`는 Task 5 전체와 Task 6 스크립트에서 같은 이름이다.
- Zod resource id(`NormalizedBidRoster` 등)와 생성된 Pydantic 클래스 이름은 `meta({ id })`에서 파생되므로 한 곳에서만 정한다.
- code scheme 문자열 `eat:BID_STT`·`eat:SHIPPER_CD`·`eat:BIZ_NO`·`eat:WITHDRAWAL_YN`·`eat:CHC_YN`·`eat:PLNPRC_TYPE_CD`·`eat:SUCBD_DECISION_MTHD`는 `roster.py` 상수로 한 번만 정의하고 EAT-43의 `CodeScheme` 등록이 같은 문자열을 쓴다.

### 위험과 미결

| 위험 | 왜 위험한가 | 이 계획의 처리 |
| -- | -- | -- |
| v1 fingerprint 변경 | 봉인된 publication이 무효가 된다 | v1 mapping을 건드리지 않고, 공유 상수를 추출하는 Task 4에서 fingerprint 불변 테스트를 먼저 건다 |
| v1 canonical payload 재직렬화 불일치 | 모든 기존 record가 projection에서 실패한다 | v1 root를 확장하지 않고 별도 root를 만든다. Task 3 Step 4의 v1 생성물 diff 검사가 이중 잠금이다 |
| 명단 없는 상세를 전부 격리 | 유찰·개찰 전 공고 수집이 통째로 막힌다 | 새 블록을 `required`에 넣지 않는다. 합성 fixture로 그 경로를 테스트한다 |
| `parse_award_decision` 시그니처 | 계획의 두 코드 조각이 다른 인자를 쓴다 | Task 5 Step 4에 명시적으로 적었다. 구현자가 `parse_award_decision(parsed, roster)`를 고르고 테스트를 맞춘다 |
| 26,000 조사값 불일치 | 숫자를 맞추려 파서를 고치는 유혹 | 2026-09-04 표본에서 43.8%·0.153%p가 나오는 것을 미리 기록했다. 리포트는 코호트를 명시하며 숫자를 테스트에 하드코딩하지 않는다 |
| `ds_bidHistory` 보유율 2~3% | 재입찰 사슬이 대부분 비어 있다 | `lineage.links`가 빈 배열인 것이 정상이며 `parent_external_bid_id`(3.4%)와 함께 `unknown`으로 남는다. Task 7이 이 한계를 문서에 적는다 |
| `WITHDRAWAL_YN` 성숙도 | 이 값으로 나눈 비율이 수집 나이에 흔들린다 | 계약 주석과 리포트에 병기한다. 정규화는 값을 보존만 하고 파생 지표를 만들지 않는다 |
