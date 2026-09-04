# 0029 — `eat-v2` 상세 계약: `ds_bidList` 블록을 들인다

- Status: Accepted
- Accepted: 2026-09-02 — 선행 미해결(레이크 22% 원인)이 **결함도 필터도 아님**으로 판정됨
- Date: 2026-09-02
- Supersedes: 없음. `eat-v1` 은 그대로 둔다 — **덮지 않고 버전을 더한다.**
- 번호: main 병합 시 0028이 [Cache Components](0028-cache-components-and-self-hosted-cache.md)에 이미 쓰여 0029로 옮겼다. 실험 문서의 `ADR 0028` 언급은 이 결정을 가리킨다.

## Context

**현재 상세 계약(`eat-v1`)은 `ds_info` 14개 + `ds_areaList.PDLC_CD` 가 전부다. `ds_bidList` 가 통째로 없다.**

**⟹ 신 파이프라인은 투찰을 한 건도 정규화하지 않는다.**

```
승률 곡선 · 경쟁자 수 N · 위치 x · 경쟁자 분포 · 낙찰자 식별 · 투찰 도착시각
⟹ 제품 재료 전부가 계약 밖이다
```

이것이 우리 분석 전부가 **원시 직접 파싱**으로 돌아간 구조적 이유이고, `ADR 0027`(예측 승률을 경계 안으로)이 요구하는 산출물을 현재 계약으로는 만들 수 없다.

### ✅ 수집은 안 막힌다 — 정규화만 막힌다

```
http_client.py:117   HTTP 본문 **전체**를 SourceResponse.body 로
capture.py:56        store.put(body=response.body)      ← 사이에 파서가 없다
object_store.py:43   객체 키 = **본문 전체의 SHA-256**
```
🔴 **키가 본문 해시라 부분 저장이면 주소가 성립하지 않는다. 전체 저장이 구조적으로 강제된다.**
크기 상한 8 MB 대 실측 최대 477.6 KB(표본 10,818 · 평균 79.2 KB), 여유 17배. 초과 시에도 `_ResponseTooLarge` typed 실패이지 절단 경로가 없다.

**⟹ 계약 확장은 재수집을 요구하지 않는다. 이미 받은 응답에서 열린다.**

## Decision

**`eat-v2` 상세 계약을 추가한다. `eat-v1` 은 손대지 않는다.**

### 왜 덮지 않고 더하나

```python
@property
def fingerprint(self) -> str:
    return schema_fingerprint(self.datasets)
```
🔴 **계약의 지문이 `datasets` 에서 파생된다. `eat-v1` 의 `datasets` 를 바꾸면 지문이 바뀌고, 그 이름으로 이미 봉인된 정규화(`ADR 0014` run-scoped attempt · `ADR 0025` sealed raw membership)가 무효가 된다.**
**⟹ `parser_version` 이 정확히 이 상황을 위한 장치다. 쓰라고 있는 것을 쓴다.**

### `ds_bidList` 최소 필드 — 여덟

| 필드 | 왜 필요한가 | 근거 |
|---|---|---|
| `EFT_ALL_AMT` | `x` — **모든 승률 계산의 입력** | — |
| `RNK` | 서버의 낙찰 자격 판정. 두 시계 판별. 철회 회차 실제 순위 | 부록 AA |
| `BID_STT` | 낙찰자 식별(`002`). 회차당 정확히 1명이 전수 성립 | 부록 Z |
| `WITHDRAWAL_YN` | 철회. ⚠ **채움률이 수집 나이의 함수다** | 규율 31 |
| `BID_DT` | as-of `N(t)`. 실시간 경로 | 부록 K·E |
| `DRAW_NO` | 예비가격 투표 기전 | 부록 C |
| `BIZ_NO` | 사업자 식별 — 기준 사용자 추적, 대결 백테스트의 상대 | 부록 AD |
| `SHIPPER_NM` | 화면 표기 |

⚠ **`NARA_BIZ_NO` 를 넣지 않는다** — 사업자번호가 아니라 `"부정당업자가 아닙니다."` 같은 *문장*이 들어 있다. 이름과 내용이 안 맞는 필드다.

## Consequences

- **`eat-v1` 로 봉인된 것은 그대로 유효하다.** 지문도 membership 도 안 흔들린다.
- **새 정규화는 `--parser-version eat-v2` 로 돈다.** 두 버전이 공존하고, 어느 계약으로 만들어졌는지가 산출물에 남는다.
- **재수집이 필요 없다** — 이미 받은 응답 본문에 `ds_bidList` 가 들어 있다.
- ⚠ **`WITHDRAWAL_YN` 은 값이 시간에 따라 채워진다**(약 18개월). 이 필드로 나눈 모든 비율에 *성숙도*를 병기한다(규율 31).
- ⚠ **`RNK` 와 `BID_STT` 는 시계가 다르다** — `002` 는 낙찰 결정 시점 도장이고 `RNK` 는 철회 반영 후 순위다. 같은 행에 두 시각이 들어 있다는 것을 소비하는 쪽이 알아야 한다.

### 구현이 확정한 후속 결정 (EAT-42, 2026-09-04)

- **`eat-v1` 과 `eat-v2` 상세의 schema fingerprint 는 같다.** fingerprint 는 `datasets` 전체가 아니라
  `required` 부분집합으로 계산하고(`ReviewedSchemaContract`), 두 계약의 `required` 는 똑같이
  `ds_info` 네 column(`BID_NM`·`ELCTRN_BID_STT_NM`·`PURR_CD`·`PURR_NM`)이다. 그래서 블록을 셋 더해도
  봉인된 v1 발행물의 지문이 흔들리지 않는다. 계약을 구분하는 것은 지문이 아니라 `parser_version` 이다.
- **새 블록(`ds_bidList`·`ds_pList`·`ds_bidHistory`)을 `required` 에 넣지 않았다.** fingerprint 는
  *관측된* required column 으로 계산되므로, 명단이 없는 상세(유찰·공고취소·개찰 전)는 필수 column 이
  사라져 계약 위반으로 전부 격리된다. 그런 상세의 모양을 아직 관측한 적이 없어 존재를 단언할 근거가
  없다. 블록이 있는데 행을 해석할 수 없는 경우는 계약이 아니라 파서가 행 단위로 거부하고 그 관측만
  격리한다.
- **`auction.v2` record 는 아직 projectable 하지 않다.** `PROJECTABLE_RECORD_TYPES` 는 `auction.v1`
  하나이며 v2 record 가 projection 에 닿으면 typed 실패로 멈춘다. core 테이블과 projector 를 만드는
  EAT-43 이 이 집합을 넓힌다. 그 전까지 v2 정규화는 격리·전수 리포트용이지 `core` 발행 경로가 아니다.

전수 재정규화 결과와 계약 상한 조정의 근거는
[2026-09-04 리포트](../evidence/normalization/2026-09-04-eat-v2-renormalization.md)(계산 버전 `eat-v2-r3`)에 있다.

## Rejected alternatives

- **`eat-v1` 에 필드를 추가한다** — 지문이 바뀌어 봉인된 정규화가 무효가 된다. `parser_version` 이 있는 이유를 무시하는 것이다.
- **`RNK` 만 추가한다** — 구멍이 `RNK` 하나가 아니다. 투찰을 *한 건도* 안 읽는 상태이므로 블록으로 다뤄야 한다.
- **원시 직접 파싱을 계속한다** — 지금 우리가 하는 것이고, 그래서 거버넌스(`ADR 0010` append-only 관측 · `0014` attempt lineage · `0025` release manifest) 밖에서 수치가 나오고 있다. 제품이 그 위에 서면 안 된다.

## ✅ 선행 미해결 해소 — **결함도 필터도 아니다**

`parquet_v2` 가 원시의 22%(경남 4.4%)만 적재된 원인:
```
서울  48,258 / 48,258 = **100.0%**
부산   1,987 / 15,127 =   13.1%
경남   1,478 / 32,575 =    4.5%
나머지 12개 지역          **0.0%**

⟹ **지역 절단**.  run_crawl 이 지역-바깥/월-안쪽 루프라
   서울이 끝나고 부산·경남 진행 중일 때의 아카이브를 재파싱하면 이 모양이 정확히 나온다
```

| 가설 | 판정 | 근거 |
|---|---|---|
| 파서 결함 | ❌ | 무작위 600건 재실행 **600/600 성공** · 서울 100% |
| 의도된 필터 | ❌ | 서울이 100% 면 필터가 아니다 |
| 🔴 **진행 중 스냅샷** | ✅ | 지역 절단 모양이 크롤 루프 순서와 일치 |

**⟹ `eat-v2` 계약과 무관한 원인이다. 이 사유로 막을 근거가 없다. `Accepted`.**
⚠ **로그가 비어 있어 "일치하는 설명"이지 로그로 확인한 사실은 아니다. 다만 *결함·필터 아님*은 확정이다.**
⚠ **그리고 신 파이프라인 저장소(R2)의 커버리지가 미확인이다. 크론이 `suspend: true` 이고 템플릿이 `discover` 에 인자 3개를 넘기는데 CLI 는 11개를 요구하므로, 파이프라인이 끝까지 돈 적이 없을 가능성이 높다. ⟹ "재파싱으로 열린다"의 대상이 사실상 없을 수 있고, 그러면 기존 레거시 원시 아카이브(233,552)를 `ADR 0025` 의 source release 로 들이는 별도 결정이 필요하다.**
