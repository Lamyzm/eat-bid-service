# DEBT — 부채 전수조사 · SSOT 설계 심사 (2026-08-28 · refactor-critic)

읽기 전용 조사. 코드 수정 없음. **근거 없는 지적은 쓰지 않았다** — 모든 항목에 파일·줄과 재현 경로가 붙는다.

> **갱신 2 (16:30)** — 팀이 확장 의제를 지정했다. §7(서버 쿼리)·§8(mw-auction 대조)·§9(NestJS common)·§10(테스트)·§11(캐싱)·§12(라우트)를 붙이고 §13에 실행 목록을 재정렬했다. **§5의 1차 목록은 §13이 대체한다.**
>
> **갱신 1 (16:25) — 이미 닫힌 것.** 이 문서 1차본 이후 두 커밋이 들어왔다. 직접 확인했다:
> - `6d91978 파괴적 경로 3건 봉인` → **X1 닫힘**(`load_postgres.py:290-300`, 읽기 실패 시 `oj=None`으로 delete 건너뜀) · **X3 닫힘**(`app.yaml:201` `set -e` + `&&`) · **R2 닫힘**(`app.yaml:162` `ON_ERROR_STOP=1`, `|| true` 제거). A-1·A-2는 **해소**로 읽어라.
> - `af6ddc4 저장소 접근을 훅으로 모음` → `lib/use-persisted-state.ts`(105줄) 신설. **C-2의 rivals 소실 경로 닫힘.** 다만 `session.ts`의 `bizNos`/`regions` 비대칭(§2 C-2 본문)은 **그대로다** — 훅은 화면 12곳을 모았고 `session.ts`는 안 건드렸다.
> - **안 닫힌 것:** `fetch_open.py:64`는 여전히 truncate-then-write다(X2). **A-3(저장 실패 은폐)은 그대로다** — `session.ts:97-105` `res.ok` 미검사 + `app.module.ts:794` 실패를 200으로 반환, 둘 다 현재 코드에서 재확인했다.
> - **X2의 잔여 위험이 모양을 바꿨다.** X1이 잘린 JSON은 막는다. 그런데 `fetch_open.py:58-59`가 공고별 실패를 `except Exception: pass`로 삼키므로, 계통 고장은 **"짧지만 유효한 JSON"**으로 나온다. 그건 X1의 가드를 통과해 정상 적재된다. 원자성(X2)이 아니라 **건수 급감 가드**가 필요하다 → §13 X13.

**세 줄 판정:**
> ① SPEC-SSOT는 사고 1·2·6을 막고, 3을 **절반만** 막고, **4·5·7을 아예 안 본다.** 못 보는 셋은 전부 "값이 틀리는" 게 아니라 "값이 조용히 사라지는" 종류다.
> ② 설계가 유일하게 승리 선언한 칸(**A20 사용자 상태 저장 🟢 "처음부터 SSOT였다"**)이 이 리포에서 제일 크게 틀렸다. 로그인 사용자의 저장은 **지금 조용히 실패할 수 있다**.
> ③ 이번 주 최대 위험은 부채가 아니라 **청소 자체다.** 스타터 라우트 하나(`/dashboard/overview`)가 배포 readiness 프로브에 박혀 있다 — 지우면 웹 파드가 안 뜬다.

---

## 1. 사고 7건 × 설계 판정

| # | 사고 | SPEC-SSOT가 막는가 | 근거 |
|---|---|---|---|
| 1 | 품목 첫 매치 · `MAIN_ITEMS` 뒤늦게 발견 | **○ (조건부)** | §1-0 출처 예산 + §5-0 재파싱. 단 §5-0 0-a 실패 시 §2·§5-3 전량 폐기라고 설계가 스스로 명시 |
| 2 | 지역 주소 파싱 · `SIGUNGU_CD` 미추출 | **○ (조건부)** | §2 처분표 + 실패1 폐기선(일관성 99%). 폐기선을 명시한 건 잘한 것 |
| 3 | 두 화면이 다른 말 (4회) | **△ 절반** | 판정·오늘·예보(=같은 *알고리즘* 복사)는 막는다. **다른 *엔드포인트*·다른 *limit*으로 갈리는 종류는 못 막는다** → §2 D-1·D-2·D-3 |
| 4 | DB 전량 삭제 | **✗** | 설계에 파괴적 스크립트 항목이 없다. 살아있는 경로 4개 → §2 A-1·A-2·B-2 |
| 5 | 저장 손실 경로 | **✗ (역행)** | 설계는 A20을 🟢로 닫았다. 실제로는 미발견 손실 경로 3개 → §2 A-3·A-4·B-4 |
| 6 | 회차당 값 1개 | **○** | 이미 고쳐졌고 A19가 "합치지 않는다"로 유지. 단 U38 오염값 잔존 → §4-3 |
| 7 | 스타터 잔재 | **✗ 전면 미언급** | 설계에 한 줄도 없다. 그리고 이번 주 작업의 **함정**이 여기 있다 → §2 A-5 |

**정리: 설계는 "값이 서로 다르다"는 축만 본다. "값이 없어진다"는 축(4·5·7)을 안 본다.**
사고 4·5·7은 전부 후자다. §1-0의 "(나) 적재가 자기 품질을 숫자로 신고한다"가 그 방향으로 가는 유일한 문장인데, 신고 대상이 적재 한 곳뿐이다.

---

## 2. 부채 목록 — 위험 × 빈도

위험 = 터졌을 때 사용자가 잃는 것. 빈도 = 트리거가 얼마나 자주 당겨지는가.

### A급 — 지금 데이터를 잃거나, 이번 주 작업이 밟는다

---

**A-1. `open_auctions` 전량 소실 경로 — 매일 03시 무인 실행. 에러 0개.** 〔위험 최상 · 빈도 매일〕

```python
# F:/Project/eat-bid/tools/serve/load_postgres.py:291-295
try:    oj = json.load(open(.../bidboard/open_auctions.json))
except Exception: oj = []
cur.execute("delete from open_auctions")   # ← 291-294가 실패해도 무조건 실행
for o in oj: ...                            # 0건 insert
```

먹이를 주는 쪽:
- `F:/Project/eat-bid/tools/bidboard/fetch_open.py:64` — `json.dump(open_aucs, open(OUT,"w",...))`. `open(...,"w")`가 **바이트를 쓰기 전에 기존 파일을 0바이트로 자른다.** 임시파일도 `os.replace`도 없다. 같은 리포의 `src/eatbid/archive.py:40-43`은 이미 temp+rename을 쓴다 — 올바른 패턴이 옆에 있는데 여기만 안 쓴다.
- `fetch_open.py:58-59` — 공고당 fetch+normalize 전체를 `except Exception: pass`. 필드명 변경·인증 만료 같은 계통 고장이 **에러가 아니라 "짧지만 유효한 JSON"**으로 나온다. 종료 코드 0.
- `infra/k8s/base/app.yaml:197` — CronJob이 `fetch_open.py && load_postgres.py`.

**재현:** 크론 실행 중 노드가 evict되거나 디스크가 차서 `fetch_open.py`가 dump 도중 죽는다 → JSON이 반쪽 → 다음 실행의 로더가 `except`로 `oj=[]` → `delete from open_auctions` → **오늘 화면 "진행 중 공고 0건"**. 이 상태는 "정말 공고가 없는 날"과 화면상 구별 불가. 로그도 비영 종료도 없다. 커밋되고 끝난다.

이게 **사고 4(DB 삭제) + 사고 5(조용한 기본값)의 합체**이고, 아직 안 터졌을 뿐이다. `load_postgres.py`의 다른 6개 DELETE는 psycopg 기본 트랜잭션(`commit()`이 :467 하나뿐)이 보호한다 — **이 경로만 정상 종료해서 커밋된다.**

---

**A-2. 스키마 적용 실패가 무시된다 — `|| true`.** 〔위험 상 · 빈도 배포마다〕

```yaml
# infra/k8s/base/app.yaml:160
command: ["sh","-c","until pg_isready ...; done; psql ... -f /schema/schema.sql || true"]
```

`|| true`가 psql의 종료 코드를 삼킨다. `schema.sql`의 ALTER 하나가 실패해도 initContainer는 성공하고 서버가 **낡은 스키마 위에서** 뜬다. 사고 4가 난 그 파일에, 사고를 다시 못 보게 하는 뚜껑이 덮여 있다.

**재현:** `schema.sql:219-228`의 `user_mark` PK 교체 DO 블록이 잠금 대기로 실패 → `|| true` → 서버 기동 → `PUT /api/me/marks`가 사업자별 행을 넣다가 구 PK에 걸려 실패 → 그리고 A-3에 의해 **사용자에게는 "✓ 저장됨"으로 보인다.**

---

**A-3. 로그인 사용자의 저장이 조용히 실패한다 — 설계의 A20 🟢가 틀렸다.** 〔위험 최상 · 빈도 저장할 때마다〕

```ts
// apps/web/src/lib/session.ts:97-105
async function put(path: string, body: unknown) {
  if (state.guest) return;
  try {
    await api(path, { method:'PUT', ... });   // ← res.ok 검사 없음
  } catch {}
}
```
```ts
// apps/server/src/app.module.ts:792-794 (putBiz · putRegions · putMarks 동일)
const uid = await this.uid(req);
if (!uid) return { ok: false, error: "unauthenticated" };   // ← HTTP 200
```

**두 겹이다.** 웹은 `res.ok`를 안 본다. 그리고 서버는 실패를 **HTTP 200**으로 돌려준다 — 웹이 `res.ok`를 봐도 못 잡는다. 로컬 쓰기는 `setMarks`(session.ts:182) 안에서 이미 끝나 있어서 **이 브라우저에서는 값이 보인다.** 다른 기기·다른 브라우저에서는 없다.

**재현:** 세션 쿠키 만료 상태에서 사장이 값을 입력 → 화면 "✓ 저장됨" → 다음 날 다른 PC에서 로그인 → 어제 친 값이 하나도 없다. 사장 피드백 원칙 *"눌렀는데 결과가 다르면 다시 안 누른다. 물어보지도 않는다"* 에 정면으로 걸린다.

이건 **사고 5의 3번째 경로**이고, 설계가 A20을 `🟢 처음부터 SSOT였다`로 닫아둔 자리다. 저장 성공 여부는 자산인데 대장에 없다 → §4-4 A23.

---

**A-4. 두 탭이 서로의 값을 지운다 — 마크 전량 치환.** 〔위험 상 · 빈도 탭 2개 쓰면 매번〕

`lib/marks.ts:26-31`이 `{...raw}` 복사 후 한 칸 고쳐 **맵 전체**를 `setMarks`에 넘긴다 → `session.ts:180-184`가 맵 전체를 localStorage(`:90`)와 `PUT /api/me/marks`(`:183`)에 쓴다 → 서버 `app.module.ts:838-839`가 `delete` 후 `insert`. 전 구간이 read-modify-write 전체 치환이다. `storage` 이벤트 리스너는 리포 전체에 0개.

**재현:** 탭 A와 탭 B가 둘 다 마크 {1,2}를 로드 → A가 3번 공고를 저장 → B가 4번 공고를 저장 → **3번이 localStorage와 서버 양쪽에서 사라진다.** 사장은 공고를 여러 개 띄워놓고 비교한다(SIM: 최대 부하일 29회차·54엔트리). 2탭은 예외가 아니라 기본 사용 패턴이다.

`setBizNos`(:169-174)·`setRegions`(:175-179), 그리고 `firms/page.tsx:54-59`의 `eat bid.rivals`도 같은 모양이다. rivals는 **서버 동기화도 백업도 없다.**

---

**A-5. 스타터 라우트가 배포 readiness 프로브에 박혀 있다 — 이번 주 청소가 밟는 지뢰.** 〔위험 상 · 빈도 1회, 하지만 이번 주에〕

```yaml
# infra/k8s/base/app.yaml:116-117
readinessProbe:
  httpGet: { path: /dashboard/overview, port: 3000 }
```

`/dashboard/overview`는 Kiranism 스타터의 차트 데모다. 병렬 슬롯 4개(`@area_stats`·`@bar_stats`·`@pie_stats`·`@sales`, 16파일)에 `constants/mock-api.ts`의 faker 데이터를 쓴다. 제품 화면이 아니고 `config/nav-config.ts:36-60`의 8개 링크에 없다.

**재현:** "스타터 잔재 제거" 커밋이 `app/dashboard/overview/`를 지운다 → 프로브가 404 → **웹 파드가 영영 Ready가 안 된다** → Service 엔드포인트에서 빠짐 → 사이트 다운. 롤백해도 원인이 커밋 diff에 안 보인다(k8s 파일은 안 건드렸으니까).

같은 종류로 `@faker-js/faker`가 **devDependency인데 런타임 라우트 핸들러가 import한다**(`app/api/products/route.ts:18`, `app/api/users/route.ts:18`). prod-only 설치로 빌드하면 지금도 깨진다. 그 라우트들은 `app.yaml:139-141`의 `/api` Prefix 규칙 때문에 **배포 환경에서는 절대 안 불린다** — 죽은 코드가 빌드만 붙잡고 있다.

---

### B급 — 사용자가 거짓을 본다

---

**B-1. 헤더가 전 화면에서 영어 목업 알림을 띄운다.** 〔위험 중 · 빈도 상시〕

`components/layout/header.tsx:14`의 주석: *"스타터 잔재(깃허브·검색·테마 셀렉터)는 제거했다"*
`components/layout/header.tsx:31`: `<NotificationCenter />`

`features/notifications/utils/store.ts:23-99`가 하드코딩 목업이다:
- *"Sarah Connor has joined the Engineering workspace."*
- *"A new product 'Dashboard Pro' has been added to the catalog."*
- *"Your Pro plan has been renewed. Next invoice on April 24, 2026"*

`notification-center.tsx:32-36`이 빨간 **5** 배지를 단다. 62세 사장의 전 화면 헤더에, 읽을 수 없는 영어로, "결제 갱신됨"이라고. 누르면 `notification-center.tsx:15-19`가 `/dashboard/overview`·`/dashboard/product`·`/dashboard/kanban`·`/dashboard/chat` — **전부 데모 화면**으로 보낸다.

주석이 청소 완료를 선언한 바로 다음 줄이 잔재다. 이게 사고 7이 안 끝났다는 증거다.

---

**B-2. `reset-dev.sql`이 "보존 대상"이라고 문서화된 테이블을 지운다.** 〔위험 중 · 빈도 개발 초기화 때〕

```ts
// packages/shared/src/db/schema/user-data.ts:1-4
/** 사용자 데이터 — ...
 *  ⚠ 재적재 보존 대상: 로더가 건드리지 않으며 reset-dev.sql에서도 제외된다. */
```
`workspaceBiz`는 그 파일 `:36`에 선언돼 있다.
```sql
-- infra/k8s/base/reset-dev.sql:13
DROP TABLE IF EXISTS "workspace_biz" CASCADE;
```

파일 헤더가 **"이 파일의 것은 안 지운다"**고 선언하는데 실제로는 지운다. 사고 4가 정확히 "문서가 말한 것과 SQL이 하는 것이 다름"이었다. `workspace_biz`는 Clerk 시절 잔재로 지금 아무도 안 읽는다(`app.module.ts:8-9` import 목록에 없다) — **그래서 더 위험하다.** 안 쓰는 테이블 하나가 "파일 경계 = 삭제 경계"라는 규약(`db/schema/index.ts:2-4`)을 조용히 거짓으로 만들고 있다. 다음에 진짜 보존 대상이 이 파일에 추가될 때 규약을 믿게 된다.

---

**B-3. 같은 학교 이력을 두 엔드포인트가 각각 답한다 — 사고 3의 미발견분.** 〔위험 중 · 빈도 공고 상세 열 때마다〕

공고 상세 화면 한 장이 같은 학교 이력을 **두 번, 다른 엔드포인트로** 가져온다:
- `app/dashboard/auction/[bidNo]/page.tsx:19` → `GET /api/schools/:id/auctions` (`app.module.ts:77`) → StripChart(`auction-detail.tsx:321`)와 `sameFloor`(`:47`)의 재료
- `app/dashboard/auction/[bidNo]/auction-detail.tsx:76` → `GET /api/rounds/school/:id` (`app.module.ts:639`) → 리허설 카운터(`:210`)의 재료

`today/page.tsx:131`의 주석이 이미 이유를 적어놨다 — *"리허설과 같은 소스(effFloor 포함) — 두 화면 숫자가 갈리면 안 된다"*. 즉 **팀은 오늘 화면에서 이 문제를 알고 우회했고, 공고 상세에서는 두 소스가 그대로 병존한다.** 한 화면 안에서 스트립 차트의 회차 수와 리허설 문장의 회차 수가 다른 목록에서 나온다.

**설계가 이걸 못 잡는 이유:** §3-1 판정선은 *"서버가 이미 답을 갖고 있으면 웹은 만들지 않는다"*이다. 여기서 웹은 값을 **만들지 않는다** — 다른 질문을 할 뿐이다. `ssot-guard.mjs`의 10개 검사 중 어느 것도 "같은 개념을 두 엔드포인트로 묻기"를 못 본다.

---

**B-4. 같은 사용자의 낙찰 건수가 화면마다 다르다 — limit이 분모다.** 〔위험 중 · 빈도 상시〕

`GET /api/firms/bids?bizNos=&limit=` 를 세 화면이 다른 limit으로 부른다:
- `record/page.tsx:38` limit **300** → `:291` 더 보기로 **5000**까지
- `wins/page.tsx:39` limit **2000** — 그런데 쓰는 건 `bidId`의 Set 하나(`:208`의 `●` 점)뿐이다
- `delivery/page.tsx:54` limit **2000** → `:56` 받자마자 `won` 아닌 행 전량 폐기

`record/page.tsx:151-152`는 한 삼항 안에서 **두 분모**를 쓴다 — `agg.totalWins/agg.totalBids`(서버 전량) 또는 `wins.length/view.length`(현재 페이지 300). `:56`의 서버 집계 요청이 `.catch(()=>{})`로 실패하면 **아무 말 없이** 후자로 내려간다.

U27/U29(*"표시 캡 300이 총계까지 깎아"*)에서 이미 한 번 터진 축이다. 그때는 한 화면 안이었고, 지금은 **세 화면 사이**다. 설계 A10은 이걸 *"값은 실려 있고 타입이 없다"*(🟡)로 적었는데 — 문제는 타입이 아니라 **호출자마다 limit이 다르고 화면이 그걸 말하지 않는 것**이다.

---

**B-5. 헤더 지역 칩·상태줄·목록이 서로 다른 셈을 한다.** 〔위험 중 · 빈도 상시〕

`GET /api/open`은 서버에 `?region=`과 `eligibleFor()`(`app.module.ts:186-189`, `:132-138`)를 갖고 있다. **웹의 6개 호출 지점 중 이 파라미터를 넘기는 곳이 0개다** (`today:100` · `auction-detail:64` · `analysis-board:373` · `welcome:94` · `region-status:16` · `region-switcher:15`).

대신 같은 페이로드를 세 번 내려받아 세 가지로 센다:
- `today/page.tsx:104-106` — `viewRegions.includes(o.sigungu)`
- `region-status.tsx:18-19` — `scope.includes(o.sigungu)`, 실패 시 `xs.length`로 폴백
- `region-switcher.tsx:17-18` — 시군구별 tally 맵

셋 다 `allowedRegions`와 무제한 공고를 **안 본다**. 서버가 이미 가진 자격 규칙과 화면 셋이 전부 다르다. `allowedLabel`·`unrestricted`(`app.module.ts:174-177`)는 웹에서 **grep 0회** — 서버가 계산해서 보내는데 아무도 안 읽는다.

지역 목록의 원천도 둘이다: `region-status.tsx:24`·`my/page.tsx:29`는 `/api/wins/regions`, `region-switcher.tsx:15`는 `/api/open`에서 유도. 헤더 칩과 페이지 안 셀렉트가 **다른 지역 목록**을 띄운다.

---

**B-6. 발주 예보가 두 벌인 걸 설계가 잡았지만, `/api/schools/forecast`는 셋째 벌이다.** 〔위험 중 · 빈도 상시〕

설계 §0-1은 `app.module.ts:56-70` ↔ `analysis-board.tsx:504-515`를 비교하며 *"기준 시각 하나가 다르다"*고 했다. 맞다. 추가로: 그 서버 구현은 `SchoolsController.forecast`이고 **`forecastCache`(`app.module.ts:33`)가 앞에 있다.** 캐시 TTL 600초(`:40`)라 기준 시각이 로컬 자정이어도 **자정 직후 10분간은 어제 자정 기준 결과를 준다.** 웹 복사본(`Date.now()`)은 캐시가 없다. 즉 어긋나는 창이 하루가 아니라 하루+10분이고, 설계 §5-1-5의 "웹 복사본 삭제"만으로는 캐시 쪽 어긋남이 남는다.

---

### C급 — 조용한 실패 · 누적

---

**C-1. `.catch(() => {})`가 24곳. 전부 "데이터 없음"과 구별 불가.** 〔위험 중 · 빈도 네트워크 나쁠 때마다〕

가장 나쁜 셋:
- `analysis-board.tsx:375` — roster 실패 시 화면이 **"이 학교는 아직 참여 기록이 없습니다"**(`:1004`)라고 말한다. **사실이 아닌 문장을 단언한다.** 헌법 위반(사실만 말한다).
- `analysis-board.tsx:374` — open 실패 시 "이 값 저장" 버튼들(`:951-989`)이 사라진다. 사장이 저장하려고 왔는데 버튼이 없고, 왜 없는지 화면이 말하지 않는다.
- `record/page.tsx:56` — 서버 KPI 집계 실패 시 **아무 말 없이** 300행 클라이언트 계산으로 내려간다 → B-4.
- `app/s/[token]/page.tsx:27-31` — 서버 장애를 **"링크가 만료됐거나 올바르지 않습니다"**(`:74`)로 표시한다. 받는 사람에게 보내는 사람 잘못이라고 말한다.

제품 코드 전체에 `response.ok` 검사가 **0개**다. `res.ok`를 보는 유일한 래퍼 `lib/api-client.ts:9`는 **import 0회**.

---

**C-2. `bizNos`/`regions` 파싱 실패는 백업도 고지도 없다 — 마크만 특별대우.** 〔위험 중 · 빈도 드묾〕

`session.ts:69-83`은 마크가 깨지면 `marksUnreadable=true`로 쓰기를 잠그고 원본을 `eatbid.marks.unreadable`에 백업하고 `today/page.tsx:192-208`이 사장에게 고지한다. 커밋 `b286067`이 제대로 한 일이다.

같은 파일 `:61-62`와 `:64-67`의 `bizNos`·`regions`는 **`catch {}` 후 `[]`.** 백업 없음, 고지 없음. 다음 `setBizNos`가 `writeLocal`(`:88`)로 깨진 원본을 덮어쓴다. 사업자 번호가 사라지면 `/api/firms/*` 전 호출이 빈 배열을 받고 화면은 **"참여 이력 없음"**으로 보인다.

그리고 `:61`은 `JSON.parse(b)`를 **모양 검사 없이** `out.bizNos`에 넣는다. 저장값이 `"5"`면 `bizNos`가 숫자가 되고, `bizNos.join(',')`을 부르는 10개 지점이 전부 throw한다. `:62`의 `catch`는 parse만 잡지 하류를 못 잡는다.

**C-3. `mergedFor` 폴백 `'1'` — 공용 PC 교차 오염.** 〔위험 중 · 빈도 드묾〕

`session.ts:149`: `localStorage.setItem(K.merged, me.user?.id ?? '1')`. `me.user.id`가 없으면 `'1'`이 박힌다. 다음 사용자의 id가 `'1'`이 아니면 `:128`의 `needMerge`가 true가 되고, `:130-140`이 **앞 사용자의 사업자 번호와 마크를 새 사용자 계정에 합집합으로 넣고** `:150-154`가 서버에 PUT한다. 남의 데이터가 내 계정에 올라간다. `clearLocalData()`(`:187`)가 있지만 수동이고, `eatbid.rivals`는 그 목록(`K`, `:18-25`)에도 없어서 안 지워진다.

**C-4. 인메모리 캐시 4개가 무한 증가한다.** 〔위험 하 · 빈도 지역 스위처 쓸 때마다〕

`app.module.ts:33 forecastCache` · `:271 crowdCache` · `:350 monthlyCache` · `:596 topCache`. eviction 없음. `crowdCache`·`topCache`는 키가 유계지만 **`forecastCache`(`:38` 키 = sigungu CSV 정렬)와 `monthlyCache`(`:355` 동일)는 사용자 입력이 키다.** 지역 조합은 137개 시군구의 부분집합이라 상한이 없다. 헤더 지역 스위처를 계속 바꾸면 서버 힙이 계속 자란다. 재시작 전까지 안 줄어든다.

**C-5. 로더가 학교를 조용히 버린다 — 설계가 잡았으나 범위가 더 넓다.** 〔위험 중 · 빈도 적재마다〕

설계 §0-0③이 `clean_inst()→None`의 `continue`(`load_postgres.py:194-195`·`:436-438`·`:457-459`)를 잡았다. 추가분:
- `load_postgres.py:214-215` — `sgg`가 비면 `continue`. 카운터 없음.
- `load_postgres.py:217-218` — `len(opened) < 5`면 `continue`. 이건 **의도된 문턱**인데 §1-4의 적재 요약에 안 실리면 "5회 미만이라 없는 학교"와 "파싱 실패로 없는 학교"가 로그에서 구별 안 된다.
- `load_postgres.py:275-278` — `plannedPrice` 복원이 `len(ch)==4`일 때만. 아니면 `pp=None` 조용히. `effFloor`(`app.module.ts:483`·`:659`)가 통째로 null이 되고 화면은 "자료 없음".
- `clean_inst`(`:120-125`)의 `split("(")[0]`은 **정상 괄호 이름도 자른다.** `○○초등학교(병설유치원)` → `○○초등학교` → 서로 다른 두 수요기관이 **한 school_id로 합쳐진다.** 이건 행이 사라지는 게 아니라 **섞이는** 것이고 설계 §0-0③이 못 본 쪽이다.

**C-6. `SchoolSummary`·`OpenAuction` zod 계약이 죽어 있다.** 〔위험 하 · 빈도 상시〕

`packages/shared/src/domain/auction.ts:19-29`의 `SchoolSummary`에 `catCounts`·`byCatFloor`·`rsd`가 없다. `:42-53`의 `OpenAuction`에 `categories`·`categorySrc`가 없다 — **품목 다중화 전체가 계약 밖이다.** 서버는 응답을 이 스키마로 검증하지 않는다(`createZodDto`는 `SchoolsQuery`·`OpenQuery` 입력에만, `app.module.ts:15-16`). 웹은 로컬 타입 23개를 따로 쓴다.

즉 이 파일들은 **아무것도 강제하지 않으면서 "계약"이라는 이름을 갖고 있다.** 설계 A15가 이걸 🔴로 잡은 건 맞는데, 설계는 "웹 로컬 타입 23개 → shared"라고만 썼다. **먼저 shared 쪽이 현실과 다르다는 걸 고쳐야 한다** — 지금 그대로 웹을 shared에 붙이면 `categories`가 타입에서 사라진다.

---

### D급 — 죽은 코드 (위험 낮음, 부피 큼)

`config/nav-config.ts:36-60`의 8개 링크가 제품의 전부다. 나머지:

| 대상 | 위치 | 도달 가능? |
|---|---|---|
| `overview` (슬롯 4 · 16파일) | `app/dashboard/overview/` | **readiness 프로브** → A-5 |
| `product`·`kanban`·`chat`·`ai-chat`·`users`·`forms`(4)·`elements`·`react-query`·`notifications` | `app/dashboard/*` | 알림센터 링크로 도달(`notification-center.tsx:15-19`) |
| PokéAPI 호출 | `features/react-query-demo/api/queries.ts:20` | 데모 |
| `features/` 9개 디렉토리 | `ai-chat`·`chat`·`elements`·`forms`·`kanban`·`overview`·`products`·`react-query-demo`·`users` | **제품 화면이 import하는 feature는 `notifications` 하나뿐** |
| `constants/mock-api.ts`(246줄)·`mock-api-users.ts`(191줄) | faker 생성기 | A-5의 devDep 문제 |
| `components/ui/kanban.tsx` (1,048줄) | 최대 파일 | 데모 전용 |
| `cta-github.tsx:15`(Kiranism URL) · `theme-selector.tsx` · `user-nav` · `nav-main` · `nav-projects` · `nav-user` · `auth-button` · `info-sidebar` · `search-input` · `form-card-skeleton` · `time-dot-chart` | import 0회 | 죽음 |
| `lib/api-client.ts` | import 0회 | **유일한 `res.ok` 검사기** → C-1 |
| `styles/themes/` 11개 테마 CSS | `eatbid.css` 외 | 죽은 theme-selector가 주인 |
| `hooks/use-nav.ts:5-11` | RBAC 스텁, 입력 그대로 반환 | `nav-config.ts:9-34`의 30줄 RBAC 주석이 설명하는 기능이 **구현 0** |
| `hooks/use-mobile.ts` **와** `use-mobile.tsx` | 같은 이름 두 파일 | — |
| `app/layout.tsx:22-49` | 메타데이터 `'Shadcn Dashboard - Next.js Admin Dashboard Template'`, OG `/shadcn-dashboard.png` | **검색·공유에 노출** |
| `app/layout.tsx:63` | `<html lang='en'>` | 한국어 전용 제품 |
| `apps/web/package.json:5-8` | `"author": {"name":"Kiran", ...}` | — |
| `next.config.ts` | `api.slingacademy.com` 허용 | 스타터 데모 이미지 호스트 |

데모만 쓰는 의존성: `@ai-sdk/react`·`ai`·`@dnd-kit/*`(4)·`@faker-js/faker`·`recharts`·`@tanstack/react-query`(+devtools)·`@tanstack/react-table`·`@tanstack/react-form`·`nuqs`·`match-sorter`·`sort-by`·`react-dropzone`·`input-otp`·`embla-carousel-react`·`react-resizable-panels`·`vaul`·`uuid`·`zustand`·`motion`·`react-responsive`.

> **제품 화면은 react-query를 한 번도 안 쓴다**(전부 `useEffect`+`fetch`). **zustand도 안 쓴다**(`session.ts:200-210`의 손수 만든 `useSyncExternalStore`). **recharts도 안 쓴다**(`lightweight-charts` + 직접 만든 SVG). 세 라이브러리가 번들에 있는 이유가 데모뿐이다.

---

## 3. `app.module.ts` 954줄 인라인 — 판정

**판정: 부채다. 단 설계가 말하는 이유("파일이 크다"·"NestJS 철학")로는 아니다. 근거는 파일 안에 있다.**

### 부채인 근거 (측정)

**같은 판정이 이 파일 안에서만 5번 다시 쓰였다:**

| 위치 | 하는 일 | 기준 |
|---|---|---|
| `:223-225` | `results` 상태 3분류 | `bidRate < floorRate` → 하한미달 |
| `:443-444` | `firms/bids?summary=1` below/pushed | `bidRate < winRate` → below |
| `:531` | `firms/record` belowFloor | `bidRate < floorRate` |
| `:693` | `rounds/:bidId` replay status | `bidRate < winRate` |
| `:896` | `share/:token` below | `bidRate < winRate` |

**`:531`과 `:443`은 같은 화면(`내 성적`)의 KPI에 쓰이는데 기준이 다르다.** 설계 §0-3이 웹 쪽 두 곳을 잡았는데, **서버 안에서만 이미 2종이 살아 있다.** 이게 "서비스 계층 부재의 증상"이라는 §3-3의 진단을 뒷받침하는 유일한 정량 근거다.

같은 모양 더:
- `effFloor` 공식 2벌: `:483-484`, `:659-660`
- `gap12` 2벌: `:337`, `:697`
- `secondRate` SQL 조각 3벌: `:316`, `:474`, `:649`
- `bizNos` CSV 파서 4벌: `:111`, `:208`, `:320-321`, `:422`(FirmsController만 `private parse()`를 갖고 나머지 셋은 각자 인라인)
- `schoolId.split("|")` 5벌: `:45`, `:68`, `:220`, `:258`, `:306`, `:332-333`

### 부채가 **아닌** 부분

- 크기: 954줄 / 12 컨트롤러 = 컨트롤러당 ~80줄. 개별로는 읽힌다. **파일을 12개로 쪼개는 것 자체는 아무 사고도 안 막는다** — 위 중복은 전부 *같은 파일 안*에서 났다. 파일을 나눴으면 오히려 더 났을 것이다.
- 관심사 혼재: 컨트롤러들은 도메인별로 이미 갈려 있다(`schools`·`open`·`wins`·`firms`·`rounds`·`me`·`share`·`events`). 혼재가 아니라 **평평한 것**이다.
- 실제로 겪은 문제: 이 파일의 구조 때문에 난 사고는 **기록에 없다.** 사고 1~7 중 어느 것도 원인이 "컨트롤러가 한 파일에 있어서"가 아니다.

### 결론

**추출하되 재편하지 마라.**
- **할 것:** 중복이 5·2·2번 증명된 셋만 `packages/shared/src/domain/`의 순수 함수로 뺀다 — `verdict()`·`effFloor()`·`normalizeBizNo()`. 컨트롤러는 그 자리에 둔다. 동작 변경 0.
- **안 할 것:** 설계 §3-3의 `VerdictService`/`EligibilityService`/`MoneyService`/`CalendarService` 4개 + 도메인 모듈 분리. `EligibilityService`는 **호출 지점이 `:189` 하나뿐**이다 — 중복이 없는데 서비스를 만드는 건 추측이다. 나머지 셋은 순수 함수로 충분하고, NestJS DI를 태우면 테스트 0개인 리포에 얻는 게 없다.
- **덤:** 재편 작업은 C-4(무한 캐시 4개)를 **그대로 옮긴다.** 컨트롤러 인스턴스 필드를 서비스 인스턴스 필드로 옮기면 문제가 보존된 채 이사만 한다.

---

## 4. SPEC-SSOT 공격

잘한 것 먼저, 짧게: **§1-0(값,출처)** — 내 측정치를 받아 설계의 단위를 바꾼 건 옳다. **§5-0(재파싱 선행)** — 못 하면 §2·§5-3 전량 폐기라고 먼저 적은 건 이 문서에서 제일 정직한 문단이다. **§5-5 URL 보호**, **§7 자기 약점 11개**. 여기까지.

### 4-1. 과설계 — 이번 주에 못 지킬 것

**(가) `gen:contract` + `_contract.py` 해시 봉인 → 만들지 마라.**

설계 §7-4가 스스로 *"이게 가장 약하다"*고 했고, §6-3에서 **트레이드오프 결정을 내 좌석에 넘겼다.** 답한다: **둘 다 아니다.**

- 이 파이프가 실제로 나르는 것은 §1-2의 ⚠가 인정한 대로 **`_ATOM` 25줄 + 표시 순서 6개**다. 측정 후 원본 어휘가 깨끗하면 더 줄어든다. 그걸 위해 생성기(40줄) + 빌드 훅 + 해시 검증(5줄) + **새 실패 모드(실패3)** + 커밋된 생성물이라는 **지금 없는 이중성**을 산다.
- 그리고 §1-4의 postflight 어휘 대조(**10줄**)가 **같은 사고를 이미 막는다.** 파이썬과 TS의 어휘가 갈리면 → DB에 목록 밖 값이 들어감 → 적재 실패. 갈렸는데 DB에 안 들어가는 경우는 **사용자에게 도달할 수 없다.** 생성기는 사용자에게 못 닿는 불일치를 막기 위해 110줄과 새 이중성을 지불한다.
- 실패3의 완화안("DB `vocab` 테이블")은 §1-6이 이미 기각한 안("오타가 진실이 된다")으로 되돌아간다. 설계가 스스로 원을 그렸다.

**대안: `_ATOM`은 파이썬에 둔다. `CATEGORIES`는 TS에 둔다. 둘의 정합은 postflight 10줄이 본다.** 어휘가 두 곳에 있는 건 맞다 — 하지만 **하나는 목록(TS), 하나는 표기 변이표(py)로 성격이 다르고**, 성격이 다른 두 파일은 중복 선언이 아니다.

**(나) `ssot-guard.mjs` 10개 검사 → 3개로 줄여라.**

설계 §6-2가 *"3개월 뒤 40줄이면 가드는 죽은 것"*이라고 스스로 썼다. 그 죽음을 **첫날에** 부르는 검사가 목록에 둘 있다:

- `Math.floor(*.length / 2)` — 이건 정렬배열 중앙값이다. `app.module.ts` `:63`·`:159`·`:397`·`:461`에서 서버가 정당하게 쓴다. `apps/web/**`에만 금지하면 웹 정렬 헬퍼가 즉시 걸리고 **allowlist 첫 항목이 된다.**
- `864e5` — 밀리초/일. 날짜 빼기 어디에나 나온다. 같은 운명.

두 검사는 "알고리즘 복사"의 **대리 지표**지 알고리즘이 아니다. 대리 지표로 빌드를 깨면 사람은 지표를 우회한다.

**남길 셋** (전부 실제 사고에 1:1 대응):
1. `apps/web/**`의 `'밀림'|'하한미달'|'무효'` 판정 표현식 → 0-3
2. `` `${…}|${…}` `` 템플릿 → 키 조립 (웹 4곳·서버 1곳)
3. `data-plane/load_postgres.py` 존재 → 로더 두 벌

**추가로 넣어라** (내가 찾은 것 중 grep으로 잡히는 것):
4. `apps/web/**`의 `.catch(() => {})` / `.catch(()=>{})` — C-1의 24곳. **오탐이 거의 없고**, 지금 제품의 최대 조용한 실패원이다.

**(다) `Sourced<T>` — 범위는 맞다. 강제력 주장이 과하다.**

§7-9의 "품목 하나에만"은 옳다. 하지만 §1-0의 *"객체라서 React가 못 렌더하고 컴파일이 깨진다"*는 **탈출구가 넷이다**: 템플릿 리터럴 `` `${o.category}` ``, `title={}`/`aria-label={}` 같은 string prop, `JSON.stringify`, `as any`. 넷 다 tsc 통과다.
그리고 §1-0 마지막 줄이 *"`stated()` 밖의 `.v` 를 가드가 grep 한다. §1-5"*라고 약속하는데 — **§1-5 표에 `.v` 행이 있다.** 확인했다. 다만 `.v`는 두 글자라 오탐이 폭발한다(`e.v`, `event.v`, 어떤 객체든). **`Sourced` 타입의 필드명을 `.v`가 아니라 `.value`나 `.raw` 같은 grep 가능한 이름으로 바꿔라.** 한 글자 결정이 가드의 생사를 가른다.

**(라) §5-2-11 "schema.sql을 drizzle snapshot에서 생성" → 이번 주에서 빼라.**

한 줄짜리 생성이 아니다. 지금 `schema.sql`은 `CREATE TABLE IF NOT EXISTS` + `ALTER ... ADD COLUMN IF NOT EXISTS` **멱등 라이브 마이그레이션**이고(`schema.sql:1-5`가 이걸 명시적 설계로 선언한다). drizzle이 내는 건 `CREATE TABLE`(멱등 아님)과 `__drizzle_migrations` 추적 테이블 기반 마이그레이션이다 — **이 DB에 그 테이블이 없다.** 그리고 architect가 짚은 비용이 하나 더 있다: **데이터플레인 이미지가 파이썬이라 `drizzle-kit migrate`를 돌릴 노드가 없다.**

> **정정 (architect 지적 수용).** 1차본에서 나는 *"`app.yaml:160`이 매 배포마다 실행한다"*고 썼다. **틀렸다.** `app.yaml:150`은 `kind: Job`(`initial-load`)이고 ArgoCD hook 어노테이션이 없다 — 확인했다. 한 번 생성되고 끝난다. 연기 판정 자체는 유지되지만(위 두 이유), 교체 범위는 내가 쓴 것보다 좁다. **그런데 이 정정이 더 나쁜 걸 연다 — A-6을 보라.**

즉 #11은 "생성 자동화"가 아니라 **살아있는 DB의 마이그레이션 메커니즘 교체**다. 사고 4가 정확히 그 파일에서 났다. 그리고 §5-5가 금지한 *"한 배포에서 스키마와 값 규칙 동시 변경"*의 정신에 걸린다.

한편 `packages/shared/drizzle/20260827064745_.../migration.sql`은 **`categories`·`category_src`·`cat_counts`·`by_cat_floor`·`school_roster_cat`·`user_mark.biz_no`가 전부 없는 08-27 상태로 멈춰 있다.** 그리고 루트 `package.json:11`에 `db:push`가 있다 — drizzle push는 대화형 확인 뒤 컬럼을 **떨어뜨릴 수 있는** 명령이 운영 DATABASE_URL을 기본값으로 들고 앉아 있는 것이다(`drizzle.config.ts:6`).

### 4-2. 설계가 못 본 자산

| # | 자산 | 왜 자산인가 | 지금 |
|---|---|---|---|
| **A23** | **저장 성공 여부** | 로컬 쓰기와 서버 쓰기가 갈리면 화면이 "✓ 저장됨"으로 **거짓말한다.** 설계가 A20을 🟢로 닫은 자리 | 🔴 `session.ts:97-105` ok 미검사 + `app.module.ts:792-794` 실패를 200으로 반환 |
| **A24** | **배포 계약** (프로브 경로 · `/api` ingress · initContainer 종료코드) | 코드 삭제가 배포를 깬다. `infra/k8s/base/app.yaml`은 소스인데 대장에 없다 | 🔴 `:117` 데모 라우트 의존 · `:160` `\|\| true` |
| **A25** | **`open_auctions.json` 원자성** | 이 시스템에서 **서빙 테이블을 에러 없이 비울 수 있는 유일한 경로** | 🔴 `fetch_open.py:64` + `load_postgres.py:291-295` |
| **A26** | **응답 limit = 분모** | 같은 질문에 호출자마다 다른 limit → 화면마다 다른 총계. A10(타입)과 다른 문제 | 🔴 300/2000/5000 세 화면 |
| **A27** | **엔드포인트 선택** | 같은 개념을 두 엔드포인트로 묻는 것. §3-1 판정선("웹이 값을 만들지 마라")이 **구조적으로 못 잡는 축** | 🔴 B-3·B-5 |

A25가 특히 A21의 거울이다. A21은 *"적재가 자기 품질을 숫자로 신고한다"*인데 — **0행 적재는 자기를 성공으로 신고한다.** §1-4의 자기검사 SQL 네 줄 어디에도 "행이 0이면 실패"가 없다.

### 4-3. 마이그레이션이 깨뜨릴 것

**(가) 6행을 지키려고 영구 이중성을 산다.**
`user_mark` 4행 · `user_biz` 2행 · `user_region`(사실상 소수). §5-5가 이 행들의 재작성을 금지하고, 그래서 §5-3-15가 *"코드 우선, 없으면 id"* **영구 폴백**을 만든다. 설계 §7-5가 그걸 *"의도한 부채이고, 갚을 날짜를 나는 못 정했다"*고 인정한다.

**6행짜리 부채에 갚을 날짜가 없을 수 없다.** 6행이면 1회성 검증 마이그레이션(구 값을 컬럼에 남기고 신 값 채움 → 눈으로 확인)이 폴백보다 싸다. §5-5의 "user_* 행 재작성 금지"는 **사고 4(수백만 행 소실)에서 나온 규칙인데 6행에 적용되고 있다.** 규칙의 근거와 적용 대상의 규모가 안 맞는다. 이건 리팩터링이 아니라 데이터 변경이므로 **사장 승인 항목**으로 올려라 — 승인되면 §7-5의 이중성이 사라진다.

**(나) URL 키는 지키는 게 맞다.** `school_id="김해시|임호초등학교"`가 분석판 URL에 있다(`analysis/[id]/page.tsx:13`이 디코드해 `split('|')[1]`). §5-3-14가 `schools.id`를 그대로 두는 건 옳다. 여기는 공격하지 않는다.

**(다) `events` 227행 × `screen` 리터럴.** A18이 `screens.ts` 유니온을 제안한다. 화면 키 이름이 하나라도 바뀌면 227행과 `/api/events/summary`의 30일 창(`app.module.ts:930-941`)이 **조용히 갈린다** — 옛 이름 행은 그냥 다른 화면으로 집계된다. 게이트 측정(G1, 관측창 9/15~9/30)이 이 숫자 위에 서 있다. **관측창 전에 화면 키를 바꾸면 게이트가 무효가 된다.** 설계에 이 제약이 없다.

**(라) `SchoolSummary`/`OpenAuction` zod가 현실과 다르다** (C-6). §5-2-9 "웹 로컬 타입 23개 → shared" 전에 shared 쪽을 현실에 맞춰야 한다. 지금 그대로 붙이면 `categories`·`categorySrc`·`catCounts`가 타입에서 사라지고, **품목 다중화 작업 전체가 타입에서 후퇴한다.**

### 4-4. 커버리지 예산 — 게이트로 만들지 마라

§1-0의 *"직전 적재보다 `original` 비율이 떨어지면 실패"*. 설계 §7-10이 스스로 우려했다. 더 구체적인 이유:

**로더는 `app.yaml:197`의 CronJob으로 매일 무인 실행된다.** 매일 증분 크롤이 붙으므로 비율은 매일 흔들린다. 일간 비율에 임계값을 걸면 **노이즈에 걸린다** → 크론이 실패로 끝남 → `restartPolicy: OnFailure` 재시도 → 반복 실패 → 사람이 임계값을 끄거나 예외를 넣는다. 이게 §6-2가 예언한 죽음이고, 이번엔 코드가 아니라 **데이터 파이프라인**에서 난다.

**대안:** baseline은 커밋한다(그건 옳다 — 나쁜 상태를 숫자로 박는 §1-0의 핵심). 하지만 **게이트가 아니라 적재 요약의 한 줄**로 만든다. 빌드를 깨는 건 "출처가 `null`인 행이 있다"(§1-4의 셋째 SQL) 하나면 된다 — 그건 이진 판정이고 노이즈가 없다.

### 4-5. 설계가 자기 문서 안에서 어긋난 곳

- **§0-0b가 "0단계"를 선언하는데 §5-0의 표는 0-a~0-d 네 줄이고, §5-0b가 여전히 "선행 측정"이라는 이름으로 그 위에 앉아 있다.** 어느 게 먼저인지 두 절이 다르게 읽힌다. §5-0 본문은 "측정보다 먼저"라고 하고 §5-0b 표제는 "선행 측정"이다.
- **§7-0이 *"같은 종류를 또 놓쳤을 수 있다"*고 썼다.** 이 리포의 사고 4·5·7이 그 "같은 종류"다 — 셋 다 *"적재/저장 경로의 현재 상태를 안 보고 계약만 설계"*의 결과다. §7-0의 자기진단이 맞았다.
- **사고 1~6이 어디에도 열거돼 있지 않다.** 설계가 *"여섯 번 실패했다"*, *"다섯 번째 사고"*, *"세 번째 실패"*를 논지의 척추로 쓰는데 번호와 사건의 대응표가 리포 전체에 없다. 인용할 수 없는 근거다. **이 문서 §1의 표가 그 대응표의 첫 판이다.**

---

## 5. 리팩터링 주간 실행 목록

기준: **동작을 바꾸지 않는 것만 "리팩터링"이다.** 동작을 바꾸는 건 §6으로 분리했다.
달력 제약: 9/12 동결 · 9/15~9/30 관측창 무배포(PLANNING-LOG #10).

### 이번 주에 **할 것** (전부 동작 불변, 전부 반나절 이하)

| # | 작업 | 막는 것 | 비용 |
|---|---|---|---|
| R1 | `app.yaml:117` readiness 프로브를 `/healthz`(서버) 또는 제품 라우트로 교체 | **A-5 — 다른 모든 청소의 전제** | 1줄 |
| R2 | `app.yaml:160`의 `\|\| true` 제거 | A-2 | 1줄 |
| R3 | `reset-dev.sql:13` `workspace_biz` DROP 제거 **또는** `user-data.ts:1-4` 주석을 사실로 수정 | B-2 (규약 거짓 제거) | 1줄 |
| R4 | 알림센터를 헤더에서 분리 (`header.tsx:31`) + `features/notifications` 제거 | B-1 | 1파일 |
| R5 | `app/layout.tsx:22-49` 메타데이터·OG · `:63` `lang='ko'` · `package.json:5-8` author | 스타터 정체성 노출 | 3곳 |
| R6 | 죽은 라우트·feature·mock 삭제 — **R1 이후에만.** `overview`·`product`·`kanban`·`chat`·`ai-chat`·`users`·`forms`·`elements`·`react-query`·`api/products`·`api/users` + `features/` 9개 + `mock-api*.ts` + `kanban.tsx` + import 0회 컴포넌트 11개 | D급 전량 · 빌드 시간 · devDep 런타임 의존 | 큰 삭제 1회, 위험 낮음(도달 불가 확인됨) |
| R7 | 위 삭제로 고아가 된 의존성 제거 (react-query·zustand·recharts·dnd-kit·faker 등 20개) | 번들·설치 시간 | package.json |
| R8 | `verdict()`·`effFloor()`·`normalizeBizNo()`를 `shared/src/domain/`으로 추출. **컨트롤러 위치 불변** | 서버 내부 중복 5·2·4 → §3 | 3함수 |
| R9 | `analysis-board.tsx:504-515` 발주 예보 삭제 → 서버 응답 사용 (설계 §5-1-5). **단 `forecastCache` TTL 600초도 함께 본다** → B-6 | 사고 3·설계 0-1 | 1블록 |
| R10 | `SchoolSummary`·`OpenAuction` zod를 현재 테이블에 맞춤 (`categories`·`categorySrc`·`catCounts`·`byCatFloor`·`rsd` 추가) | C-6 · §5-2-9의 전제 | 2스키마 |
| R11 | `ssot-guard.mjs` — **검사 4개만**(§4-1-나). `Sourced` 필드명을 `.v`에서 grep 가능한 이름으로 | 설계 §6-2의 조기 죽음 | 60줄 → 25줄 |

**R1이 R6의 전제다. 순서를 뒤집으면 사이트가 내려간다.**

### **미룰 것** (필요하지만 이번 주 아님)

| 작업 | 왜 미루나 |
|---|---|
| `Sourced<T>` 도입 (§5-2-7b) | §5-0 재파싱 결과 전에 도입하면 화면이 "62% 추정"이라고 말한 뒤 재파싱으로 숫자가 바뀐다. **한 번만 말하게 하라.** 재파싱 후 |
| `vocab/` + 코드북 (§5-2-7, §5-3) | §5-0 측정 미완. 설계가 스스로 폐기 조건을 걸었다 |
| 브랜디드 타입 `SchoolId` (§5-2-8) | R8 뒤에 하면 훨씬 싸다. 그리고 §7-3대로 서버 SQL 문자열은 못 잡으므로 기대치를 먼저 낮춰야 한다 |
| 웹 로컬 타입 23개 → shared (§5-2-9) | **R10이 먼저.** 지금 붙이면 품목 다중화가 타입에서 후퇴 |
| `data-plane/load_postgres.py` 삭제 (§5-1-6) | 105줄 구버전. 삭제 자체는 싸지만 배포 이미지가 어느 쪽을 쓰는지 확인 필요 |
| `record/page.tsx` 등 화면 중복 제거 (§3-1 표) | R8이 서버에 착지한 뒤. 순서를 바꾸면 웹 중복이 서버 중복을 복사한다 |

### **안 할 것**

| 작업 | 이유 |
|---|---|
| `gen:contract` + `_contract.py` 해시 봉인 | §4-1-가. postflight 10줄이 사용자에게 도달 가능한 불일치를 이미 막는다. 새 이중성(실패3)을 산다 |
| NestJS 도메인 모듈 분리 · 서비스 4개 (§3-3) | §3. 중복은 순수 함수 3개로 닫힌다. `EligibilityService`는 호출 1곳. 테스트 0개 리포에 DI를 태워 얻는 게 없다 |
| `schema.sql`을 drizzle에서 생성 (§5-2-11) | §4-1-라. 라이브 마이그레이션 메커니즘 교체다. 사고 4가 난 파일 |
| 커버리지 **게이트** (§1-0) | §4-4. baseline 커밋은 하되 빌드/적재를 깨지 않는다. 일간 크론에서 노이즈로 죽는다 |
| `ssot-guard`의 `864e5`·`Math.floor(len/2)` 검사 | §4-1-나. 첫날 allowlist를 부른다 |
| 화면 키(`screen`) 이름 변경 | §4-3-다. 관측창(9/15~9/30) 전에 바꾸면 G1 측정이 무효 |
| 파이프라인 TS 재작성 · CI 구축 | 설계 §1-6 기각에 동의 |

---

## 6. 동작을 바꾸는 제안 — **리팩터링이 아니다. 별도 승인 필요**

브리프의 규정대로 분리한다. 아래는 전부 **행동/데이터가 바뀐다.**

| # | 제안 | 근거 | 판정 |
|---|---|---|---|
| **X1** | `load_postgres.py:291-295` — JSON 로드 실패 시 `delete from open_auctions`를 **안 한다** (기존 행 유지 + 비영 종료) | A-1 | **즉시. 이번 주 최우선.** "안 되는 건 안 도는 거다"의 올바른 구현 |
| **X2** | `fetch_open.py:64` temp+rename (`archive.py:40-43` 패턴 복사) | A-1 | 즉시 |
| **X3** | `app.yaml:197`의 `;`를 `&&`로 — `update_lake.py` 실패 시 로더가 **낡은 레이크로 7개 테이블을 재구축**하는 것을 막는다 | 사고 4형 · 매일 무인 | 즉시 |
| **X4** | `app.module.ts:792/805/817` 인증 실패를 **401**로 반환 + `session.ts:100`에서 `res.ok` 검사 + 실패 시 사장에게 고지 | A-3 | 즉시. 지금 사장이 친 값이 사라질 수 있다 |
| **X5** | 마크 저장을 전량 치환에서 **단건 PATCH**로 | A-4 | 승인 필요(API 계약 변경) |
| **X6** | `session.ts:149`의 `?? '1'` 제거 — id 없으면 merge 안 함 | C-3 | 즉시 |
| **X7** | `bizNos`·`regions` 파싱 실패에 마크와 **같은** 정책(백업+쓰기잠금+고지) | C-2 | 승인 필요(UX 추가) |
| **X8** | `/api/open` 호출 6곳이 `?region=`을 넘긴다 + `allowedLabel`·`unrestricted`를 읽는다 | B-5 | 승인 필요(**보이는 공고 수가 바뀐다**) |
| **X9** | `firms/bids` limit을 화면 셋이 통일 + 화면이 캡을 말한다 | B-4 · U27 재발 | 승인 필요 |
| **X10** | U38 오염값(`9006`·`8807`) 마이그레이션 | UX-LOG U38 · §5-5와 충돌 | **사장 판정 필요.** 4행짜리 문제에 §5-5가 걸려 있다 |
| **X11** | `clean_inst`의 괄호 절단을 **정상 괄호 이름과 주소 오염**으로 나눈다 | C-5. 지금 서로 다른 수요기관이 합쳐진다 | 승인 필요(학교 목록이 바뀐다) |
| **X12** | `forecastCache`·`monthlyCache`에 상한(LRU 200) | C-4 | 즉시 |

---

## 부록 — 이번 주 다음 순번을 위한 미해결

- `PDLC_NM` 측정(설계 §5-0b) 전에는 A11·§5-3-17을 인용하지 않는다. 설계 §7-1에 동의.
- A6(`bids.valid` vs `bid_rate < win_rate`) 정의 선택은 data 좌석 몫. **단 `app.module.ts:531`과 `:443`이 이미 다른 답을 쓰고 있다는 사실은 선택 전에도 고칠 수 있다** — 둘 중 하나로 통일하는 건 정의 선택이 아니라 일관성 복구다.
- 티켓 ID 네임스페이스 충돌: `D1/D3/D5`(DESIGN 백로그) vs `D6/D8`(data 티켓), `R1~R6`이 QA 결함·인지부하 규칙·위험 세 뜻. 이 문서는 `A/B/C/D`(부채 등급)·`R`(리팩터링)·`X`(동작 변경)를 쓴다 — **네 번째 충돌을 만들었다.** 다음 회전에서 팀이 하나로 정리해야 한다.

---

## 7. 서버 쿼리 — 단축 가능 여부 (의제 3-a)

### 7-0. 먼저, 이 절에서 제일 큰 발견 — **S-1 처방이 적재만 되고 서빙이 안 된다**

로더가 계산해서 DB에 넣어둔 것을 서버가 **한 번도 안 읽는다.** grep 실측:

| 로더 산출물 | 만드는 곳 | 서버 읽기 | 웹 읽기 |
|---|---|---|---|
| `schools.by_cat_floor` (품목×하한 2단 통계) | `load_postgres.py:252-260,270` | **0회** | **0회** |
| `school_roster_cat` (학교×품목 단골) | `load_postgres.py:425-446` | **0회** | **0회** |
| `schools.cat_counts` (품목별 회차 수) | `load_postgres.py:269` | 2회 — 둘 다 `SchoolsController.list:25`의 **필터 SQL 문자열 안**. 응답에 안 실린다 | **0회** |
| `schools.rsd` (예정가 출렁임) | `load_postgres.py:228,267` | **0회** | **0회** |

**S-1은 이 팀이 SIM-USERFLOW에서 찾은 최대 결함이다** — *"임호초 '74회' = 공산25+수산25+축산24 … '사실 + n 명시'가 헌법인데 **그 n이 틀린 n**이다."* PLANNING-LOG는 이걸 "data P4 진행 중"으로 달아뒀고 SPEC-BATCH §0는 여기 막혀 있다.

**실제 상태는 "진행 중"이 아니다. 데이터는 이미 DB에 다 있고, API가 안 내보내서 화면이 여전히 틀린 n을 쓴다.**
- `/api/schools/:id/roster`(`app.module.ts:91-106`)는 여전히 **혼합** `schoolRoster`를 준다. 축산 사장이 수산 조합을 보는 그 화면이다.
- `OpenController.enrich`(`:149-150`)는 `sc.byFloor`(전 품목 합산)를 쓴다. 바로 옆에 `sc.byCatFloor["축산"]`이 있는데 안 본다.

이건 "쿼리 단축"의 정반대이면서 동시에 최고 사례다 — **런타임에 다시 만드는 게 아니라, 이미 만들어 둔 정답을 두고 틀린 걸 읽는다.** 쿼리 한 줄도 안 늘고 화면이 정확해진다.

### 7-1. 쿼리별 판정표

| 엔드포인트 | 현 복잡도 | 단축 | 분리 대상 |
|---|---|---|---|
| `GET /api/open` `:183-192` | **1 + 2N.** `db.select().from(openAuctions)` **WHERE·LIMIT 없음**(`:185`) → JS 필터 → `Promise.all(map(enrich))`. `enrich`(`:143-181`)가 행마다 `schools` 1 + `schoolAuctions` **무한정**(`:152-154`, 그 학교 전 이력) 2쿼리 | **최우선.** ① `region`·`category`를 **SQL WHERE로**(지금 JS 필터, `:187-190`) ② `enrich` 배치화 — `inArray(schools.id, ids)` 1회 + `schoolAuctions` `inArray` 1회로 **1+2N → 3** | `open/` |
| `GET /api/wins/monthly` `:352-406` | `schoolAuctions` 4컬럼을 **날짜 경계 없이 전량**(`:358-365`) 가져와 `:376-377`에서 JS로 `m < co` 컷 | **`gte(openedAt, co)`를 WHERE에.** `months=12`인데 116,892행을 다 읽는다 | `wins/` |
| `GET /api/schools/forecast` `:35-75` | 지역 미지정이면 `schoolAuctions` 전량(`:42-46`) → JS 그룹핑 | 최근 N개월 경계를 WHERE에. 중앙값 간격 계산은 SQL로 옮기면 **읽기 어려워진다 — JS 유지 권장** | `schools/` |
| `GET /api/wins/regions` `:255-268` | 전 `school_auctions` GROUP BY → `:265-267`에서 JS로 정규식+n≥20 필터 | `HAVING count(*)>=20`을 SQL로. 하루 1회 바뀌는 정적 목록 | `wins/` |
| `GET /api/firms/record` `:523-545` | `firmBids` **전 행**(`:527`)을 끌어와 JS 집계(`:529-535`) | **그리고 이미 SQL 버전이 있다** — `/firms/bids?summary=1`(`:433-462`)이 **같은 집계를 `count(*) filter(...)`로** 한다. **같은 수를 두 방식으로 만드는 중** | `firms/` |
| `GET /api/firms/timeline` `:548-564` | 전 행 → JS 월별 롤업(`:554-561`) | `group by to_char(opened_at,'YYYY-MM')` | `firms/` |
| `GET /api/share/:token` `:873-907` | 전 행 스캔 + JS 집계. **공개·무인증** | `record`와 같은 SQL 집계 재사용 | `share/` |
| `GET /api/wins/recent` `:295-347` | 최대 1000행 + 4쿼리(count·firmBids agg·mine·names) | 배치는 이미 옳다. **인접 `crowd`·`monthly`는 캐시가 있는데 얘만 없다** | `wins/` |
| `GET /api/firms/ties` `:499-520` | `firm_bids` self-join + 8컬럼 GROUP BY + HAVING | self-join은 정당. 단축 여지 낮음 | `firms/` |
| `GET /api/rounds/school/:id` `:639-674` | 3쿼리, 전부 `inArray` 배치 | 이미 옳다 | `rounds/` |
| `GET /api/results` `:205-227` | 2쿼리 배치 | 이미 옳다 | `results/` |

**나머지 배치 경로는 전부 정상이다.** `inArray` + `Map` 조인 패턴이 `:82-86`·`:210-214`·`:313-327`·`:472-479`·`:615-616`·`:645-654`·`:685-686`에서 일관되게 지켜진다. 잘한 것이고, 그래서 `/api/open` 하나만 튄다.

### 7-2. `bids.valid` — 쿼리 문제이자 계약 문제 (architect §0-3 지지)

판정이 서버 안에서만 **5벌**(`:223`·`:443`·`:531`·`:693`·`:896`)이고 그중 `:443`과 `:531`은 **같은 화면 KPI에 다른 기준**을 쓴다(§3). 웹에 3벌이 더 있다 — `analysis-board.tsx:52-57`(`verdictOf`, 유일하게 이름 붙은 것)·`auction-detail.tsx:208`·`today/page.tsx:432`. **총 8곳.** (front 좌석은 2벌로 봤는데 3벌이다.)

원본 `bids.valid`가 답을 갖고 있는데 안 실었다. `firm_bids.valid` 컬럼 하나 추가가 8곳을 없앤다 — 이건 캐시나 인덱스가 아니라 **안 실은 컬럼**이 만든 쿼리 부채다.

### 7-3. LIKE 이스케이프 없음 (mw-auction `escape-like.ts` 대응물 부재)

`app.module.ts:26` `ilike(schools.name, '%'+q+'%')` · `:591` `ilike(firms.name, '%'+t+'%')` · `:591` `ilike(firms.bizNo, bz+'%')`.
drizzle이 파라미터화하므로 **주입은 아니다.** 다만 사용자가 `%`나 `_`를 치면 LIKE 와일드카드로 동작해 전 행 매치가 된다. 둘 다 LIMIT이 있어(50·20) 폭발은 안 한다. **위험 하 — 그러나 mw-auction이 7줄짜리 `escapeLike`를 "database.md 절대 규칙"으로 두는 이유가 이것이다.**

---

## 8. mw-auction 대조 (의제 4)

### 8-1. 규모부터 — 이걸 빼면 대조가 거짓말이 된다

| | mw-auction | eat-bid | 배수 |
|---|---|---|---|
| 서버 소스 | **269 파일 · 27,560줄** | **4 파일 · 1,019줄** (app.module 954 · auth 44 · main 15 · db 6) | 27× |
| 웹 소스 | 516 파일 · 38,088줄 (평균 74줄/파일) | — | |
| 테스트 | **205** (서버 107 · 웹 77 · shared 21) | **0** | — |
| 프로세스 | 2 (ingest/public, `MODE` 스위치) | 1 (`replicas: 1`) | |
| 도메인 | 실시간 경매 · 고write · WebSocket | **하루 1회 배치 · 읽기 전용** | |

**mw-auction 분리의 정당성은 절반이 규모, 절반이 도메인이다.** 우리는 둘 다 다르다. 그래서 "따르는가"의 답은 항목마다 갈린다.

### 8-2. 파일 크기 — mw-auction **자기 기준**으로 재면 우리는 10곳에서 위반한다

mw의 `.claude/rules/file-size.md`: *"≤100 이상적 / 100~200 허용 / **200+ 분리**"*. 분할 트리거 표: *"컨트롤러 라우트 8+ → 모듈 분리 / 서비스 메서드 6+ → 역할별 분리"*. 동기까지 적혀 있다 — *"duck-power 교훈: 300줄+ 파일 87개 → 리팩터링 2주. 구조를 먼저 잡으면 300줄이 될 일이 없다."*

| 우리 파일 | 줄 | 책임 수 | mw 기준 |
|---|---|---|---|
| `analysis-board.tsx` | **993** | 렌즈 7 + 차트 + 예보 + 판정 + 저장 + 프리페치 | 위반 (mw 최대 손수 컴포넌트 **337**) |
| `app.module.ts` | **954** | 컨트롤러 12 · 라우트 ~45 · SQL · HMAC · 인증 위임 | 위반 (mw 최대 비테스트 서버 파일 **552**, 최대 컨트롤러 **225**) |
| `today/page.tsx` | **551** | 히어로 + 카드 + 컴팩트행 + 예보 + 결과 + 배지 | 위반 |
| `load_postgres.py` | **490** | 분류기 + 7테이블 적재 + 집계 | 위반 |
| `auction-detail.tsx` | **403** | 탭 3 + 계산기 + 리허설 + 차트 | 위반 |
| `record` 314 · `delivery` 314 · `schools` 234 · `wins` 233 · `firms` 204 | | | 위반 |

mw의 **자기 트리거 규칙으로도** `app.module.ts`는 갈린다(라우트 8+ 컨트롤러가 12개). 이건 "프레임워크가 그러니까"가 아니라 **우리가 참고 리포로 지정한 코드베이스의 명시적 수치 기준**이다.

### 8-3. 항목별 — 따르는가 / 우리에게 맞는가

| mw-auction 방식 | 우리 | 따를까 | 근거 |
|---|---|---|---|
| **파일 200줄 상한 + 훅 경고** | 10곳 위반 | **부분 채택** — 상한을 규칙으로 걸지 말고, 위 10개 중 **`app.module.ts`와 `analysis-board.tsx`만** 손댄다 | §3: 우리 중복은 *같은 파일 안*에서 났다. 크기가 원인이 아니다 |
| **Controller→Service→Repository (Symbol+interface)** | Controller만 | **안 한다. 3층도 2층도 아니다** | Symbol+인터페이스의 값어치는 **교체와 목(mock)**이다. DB 하나·읽기 전용·테스트 0이고, §10이 권하는 테스트도 **순수 함수**지 리포지토리가 아니다. DI 심볼 13개를 도입해 얻는 게 없다 |
| **컨트롤러를 도메인 모듈로 분리** | 1파일 12컨트롤러 | **파일만 나눈다** — `open`·`wins`·`firms`·`schools`·`rounds`·`me`·`share`·`events` 8파일. **서비스 클래스는 안 만든다** | 파일 분리는 병합 충돌·탐색만 좋아진다. 사고는 중복이 냈고 그건 **순수 함수 3개**로 닫힌다 |
| **SQL은 리포지토리에** | 컨트롤러 인라인 | SQL을 `domain/queries/`로 빼되 **클래스 없이 함수로** | mw도 `assign/`·워커·스케줄러 3곳에서 이 규칙이 샌다 — 그쪽이 인정한 "도메인 형태의 누수"다 |
| **`@CachePolicy` + APP_INTERCEPTOR (22정책)** | **캐시 헤더 0개** | **자리만 채택** → §11 | 우리 데이터는 07:00 KST에 하루 한 번 바뀐다. mw보다 **더** 캐시하기 좋은 모양이다 |
| **`global-exception.filter` 1개** | 없음 | **채택** | mw 주석: *"에러 응답이 endpoint마다 다르면 프론트가 고통받음."* 우리는 지금 `{ok:false}`·`null`·throw가 섞여 있고 **인증 실패가 200이다**(A-3) |
| **`{data}` 응답 봉투** | 없음 | **안 한다** | 40+ fetch 지점을 한 번에 깬다. mw는 웹 테스트 77개가 잡아주고 우리는 **0개**다 |
| **`escape-like.ts` (7줄)** | 없음 | 자리만 | §7-3. 위험 낮음 |
| **`ROUTES` + `makeRoute` + zod + spec** | **없음** | **채택 — mw보다 우리에게 더 필요하다** → §12 | 우리 경로 파라미터가 `"김해시\|임호초등학교"`다 |
| **`ssot-check.sh` + `rules.mjs` 강제** | pre-push `bun run build` 하나 | 축소 채택 | architect §1-5가 같은 결론. 검사는 4개로(§4-1-나) |
| **CDN 설정을 리포에 커밋** (`infra/cloudflare/*.json`) | **리포에 CF 흔적 0** | 자리만 | §11 |
| `singleflight` · `withDeadlockRetry` · `timeout.interceptor` | 없음 | **전부 안 한다** | 사용자 1명 · 쓰기 없음 · 크론 `concurrencyPolicy: Forbid`. mw는 고정 풀에 버스트 write가 있어 필요한 4중 방어다. **우리에겐 해결할 문제가 없다** |
| WS 게이트웨이 2개 · `cursor-queue` · 브로틀리 스냅샷 · 파티션 크론 · 초 단위 크론 분산 | 없음 | **안 한다** | 전부 실시간 경매 도메인 산물. mw 자신도 그렇게 분류한다 |
| Redis (ephemeral 전용, R11로 강제) | 없음 | **도입 금지** | 하루 1회 갱신에 Redis는 **"어제 값이 보인다"는 새 사고 유형**만 산다 |
| **주석이 사건과 이유를 담는다 (R6)** | **이미 잘한다** | 유지 | `app.module.ts:176-180`·`:230-235`·`:368-372`, `category.ts:7-10`, `app.yaml:160-161,199-200`. 이 습관은 mw와 동급이다 |

### 8-4. mw-auction 방식 중 **우리에게 안 맞는 것** (명시 요구분)

1. **응답 봉투 `{data}`** — 안전망 없이 도입하면 전 화면이 조용히 빈다. 가장 위험한 모방.
2. **리포지토리 Symbol + 인터페이스 13벌** — 순수 간접층. 컨트롤러 12개에 인터페이스를 붙이면 954줄이 **2,000줄로 늘어난다.**
3. **`MODULE_MAP.md`** — mw 스스로 *"이 파일은 stale하다"*고 인정한다(prisma로 문서화·실제는 Drizzle, `live/`로 문서화·실제는 `market/`, 25개 중 6개만 커버). **문서로 지도를 만드는 방식은 그쪽에서도 실패했다.** 우리 `docs/`는 이미 14개다.
4. **`vitest` 3개 설정 + 도커 e2e 스택** — §10에서 spec 3개만 권한다. 러너는 **`bun test`(의존성 0)**로 충분하다. pre-push가 이미 bun을 돌린다.
5. **Prometheus·Grafana·Sentry·Telegram 알림 체인** — 관측 대상이 사용자 1명이다.

---

## 9. NestJS `common/` 계층 판정 (의제 3-b)

우리 `apps/server/src`에는 이 계층이 **통째로 없다.** `main.ts` 15줄이 `setGlobalPrefix('api')` + `ZodValidationPipe` + `enableCors()`만 한다. 전부 도입은 답이 아니므로 갈랐다.

| mw 장치 | 줄 | 우리에게 | 근거 |
|---|---|---|---|
| **`global-exception.filter`** | 67 | **지금 한다** | 우리 에러 응답이 **세 가지**다: `{ok:false,error}`(`:794`·`:808`·`:830`·`:862`·`:877`) · `null`(`:197`) · 미처리 throw. 그리고 A-3의 핵심 — **인증 실패가 HTTP 200**이다. 필터 하나가 `{error,code,message,status}` 한 형태로 모으면 그때 비로소 `res.ok` 검사가 의미를 갖는다 |
| **`cache-policy` + `cache-header.interceptor`** | 45+35 | **자리만** | §11 |
| `ValidationPipe` | — | **이미 있다** | 전역 `ZodValidationPipe`. 다만 쓰는 곳이 `SchoolsQuery`·`OpenQuery` **둘뿐**이고 나머지는 핸들러 안에서 `safeParse`를 손으로 한다(`:795`·`:807`·`:821`·`:856`·`:915`) |
| `logger.module` + `logger-redact` | 88+15 | 자리만 — **단 §9-1을 먼저 읽어라** | |
| `internal-auth.guard` / `ingest-token.guard` | 45 / 32 | **안 한다** | 인증 경로가 better-auth 하나다. 가드로 뺄 중복이 없다 |
| `response-wrapper.interceptor` | 25 | **안 한다** | §8-4-1 |
| `timeout.interceptor` | 29 | **안 한다** | 고정 풀 압박이 없다. 행 쿼리 하나가 그 탭만 멈춘다 |
| `safe-cron.decorator` | 58 | **안 한다** | 우리 크론은 앱 밖 k8s CronJob이고 `concurrencyPolicy: Forbid`가 재진입을 이미 막는다 |
| `singleflight` · `with-deadlock-retry` · `db-error` | 41·30·21 | **안 한다** | 해결할 문제가 없다 |
| `ws-exception.filter` · listeners 3종 | | **안 한다** | WS 없음 · 알림 없음 |
| `unwrap-or-404` | 22 | **지금은 안 한다** | `Result` 반환 규약이 있어야 값어치가 생긴다. 서비스 계층을 안 만들기로 했으므로 딸려오지 않는다 |

### 9-1. `logger-redact`보다 먼저 — **사업자번호가 URL에 있다**

mw는 `mask-seller`와 `logger-redact`(7필드)를 둔다. 우리는 로거 설정이 아예 없어 **Nest 기본 로거**가 돈다. 그런데 우리 문제는 로그 설정이 아니라 **위치**다:

```
GET /api/firms/record?bizNos=1234567890,0987654321
GET /api/firms/bids?bizNos=...&limit=2000
GET /api/firms/ties?bizNos=...          GET /api/firms/timeline?bizNos=...
GET /api/firms/badges?bizNos=...&schools=...
GET /api/schools/:id/my-bids?bizNos=...
GET /api/results?bidNos=...&bizNos=...
```
호출 지점 실측 10곳(`record:49,53,56` · `wins:39` · `delivery:55` · `my:25` · `firms:51,52` · `auction-detail:80` · `analysis-board:348`).

**사업자번호가 쿼리스트링에 있으면 액세스 로그·CF 로그·브라우저 히스토리·Referer 헤더에 전부 남는다.** redaction으로 못 막는다 — 헤더나 바디로 옮겨야 막힌다. 리팩터링이 아니라 **동작 변경**이라 §13 X14로 분리했다.

지금 노출 규모는 작다(사용자 1명, 자기 번호). 다만 **공유 성적표(`/api/share`)로 남에게 링크를 보내는 기능이 이미 있고** G2에 카톡 발송이 잡혀 있다. 사용자가 늘기 전에 정하는 게 싸다.

---

## 10. 테스트 — 무엇에만 붙이면 사고를 막나 (의제 7)

현재 `.spec.ts`/`.test.ts` **0개**. mw는 205개다. **205개를 제안하지 않는다.**

기준을 하나만 쓴다: **"이 테스트가 있었으면 우리가 실제로 겪은 사고를 막았는가."**

| 사고 | 막았을까 | 대상 | 규모 |
|---|---|---|---|
| **1. 품목 첫 매치 · 200건 도둑질** | **그렇다** — `classify()`(`load_postgres.py:94-102`)는 인자만 받는 순수 함수다. `축수산물→[축산,수산]`, `MAIN_ITEMS` 우선, `농공산품→[농산,공산]`, 그리고 **키워드를 늘려도 다른 품목을 안 훔친다**를 고정하면 그 사고가 커밋 전에 죽는다. 팀이 이미 시뮬레이션으로 잡았다 — **그 시뮬레이션을 파일로 남기는 것이 곧 이 테스트다** | `test_classify.py` | ~40줄 · pytest |
| **3. 두 화면이 다른 말** | **단 R8 이후에만** — 지금은 붙일 함수가 없다. `verdict()` 추출 후 8곳이 그걸 부르면, 경계값(`bidRate == winRate`, `effFloor` 유무, `maxInvalid` 폴백)을 고정하는 spec이 회귀를 막는다 | `verdict.spec.ts` | ~30줄 |
| **5. 저장 손실 (46%)** | **부분** — `groupMarks()`(`app.module.ts:746-758`)와 `putMarks`의 rates↔rate 분기(`:829-837`)가 손실이 살던 자리다. 순수 함수라 목이 필요 없다 | `marks.spec.ts` | ~30줄 |
| **4. DB 전량 삭제** | **테스트가 아니다** — mw도 마이그레이션 spec을 안 쓰고 `check-migration-safety.ts` 스크립트로 막는다. 우리 대응물: **`schema.sql`에 `DROP`/`TRUNCATE`가 나타나면 실패하는 grep 스크립트** | `check-schema-safety.sh` | ~15줄 |
| **6. 회차당 값 1개** | 아니다. 스키마 설계 결함 | — | — |
| **2. 지역 코드 미추출** | 아니다. 원본을 안 본 문제 — `FIELD-LEDGER`(설계 §5-3-13)가 잡는다 | — | — |
| **7. 스타터 잔재** | 아니다 | — | — |

**결론: spec 3개 + 스크립트 1개, 합계 ~115줄.** 러너는 **`bun test`** — 의존성 0이고 pre-push가 이미 bun을 돈다(파이썬 쪽만 pytest).

**계약 스냅샷은 권하지 않는다.** 팀 지시에 후보로 올라와 있었지만: mw조차 생성 계약(`api-types.generated.ts` 744줄)이 **죽어 있고**(import 0회) 손으로 쓴 zod를 런타임 검증한다. 그런데 architect §1-3이 런타임 zod를 **기각**했다(630만 행 위 비용). 둘 다 안 하면 남는 건 **tsc**이고, R10(shared zod를 현실에 맞춤) + 컨트롤러 반환 타입 명시가 그 역할을 이미 한다. **스냅샷 테스트는 우리에게 틀린 도구다.**

**mw의 `unwrap-or-404.spec.ts`(17줄) 패턴은 맞다.** 소스 22줄에 테스트 17줄, 목 없음, 콜로케이트, 한국어 문장 테스트명. 위 3개를 정확히 그 모양으로 쓰면 된다. 따라선 안 되는 건 그쪽 **서비스 spec**(`chat.service.spec` 525줄, `database.service.spec` 647줄)이다 — 목 리포지토리가 전제고 우리는 그 층을 안 만든다.

---

## 11. 캐싱 · 인프라

### 11-1. 지금 상태 — 캐시 계층이 없는 게 아니라 **틀린 캐시가 있다**

| 층 | 상태 |
|---|---|
| CDN (Cloudflare) | **리포에 설정 0.** 그리고 오리진이 `Cache-Control`을 안 보내므로 **CF가 캐시할 근거가 없다** |
| Ingress | `app.yaml:130-144` — **`annotations:` 블록 자체가 없다.** ingressClass·host·TLS 없음 |
| Next.js | 제품 서버 컴포넌트 3개 전부 `dynamic='force-dynamic'` + `cache:'no-store'`. `revalidate`·`revalidateTag`·`unstable_cache` **0회**. 게다가 클라 `fetch('/api/…')`는 Ingress `/api` 규칙으로 **Next를 건너뛴다** — Next는 캐시할 기회조차 없다 |
| 앱 | 인메모리 `Map` **4개**(`:33`·`:271`·`:350`·`:596`), TTL 600초 |
| react-query | `lib/query-client.ts`가 설정돼 있고 `staleTime: 60s`. **제품 화면 사용 0회** — 스타터 데모만 쓴다 |

**그 4개가 유일한 캐시이고, 그게 틀렸다.**
데이터는 **07:00 KST에 하루 한 번** 바뀐다(`app.yaml:187` `0 22 * * *` UTC). TTL 600초는 그 리듬과 아무 관계가 없다. 결과가 B-6이다 — **07:00~07:10 사이 `/api/schools/forecast`가 어제 예보를 준다.** 이득(1명 사용자의 재계산 절약)은 0에 가깝고, 비용은 **화면이 거짓말하는 창 10분**이다. 헌법이 "사실을 말한다"인데 캐시가 그걸 어긴다.

그리고 `forecastCache`(`:38` 키=sigungu CSV)·`monthlyCache`(`:355` 동일)는 **키가 사용자 입력이라 무한 증가한다**(C-4).

### 11-2. 판정

**지금 할 것**

1. **`/api/open`의 1+2N 제거** (§7-1). 이건 캐시 문제가 아니다. `Promise.all`이 N×2 쿼리를 **동시에** 단일 복제 Postgres(`app.yaml:15-40`, resources 블록 없음)에 던진다. 열린 공고가 늘면 풀이 마르고, 그 실패는 웹의 `.catch(()=>{})`(C-1)를 타고 **"진행 중 공고 없음"**으로 표시된다. 사용자 1명에서도 터지는 경로다.
2. **인메모리 캐시 4개의 키를 TTL에서 `fetchedAt`으로.** `max(fetched_at)`은 로더가 남기는 유일한 타임스탬프이고(insert가 컬럼을 생략해 `defaultNow()`가 걸린다) 하루 한 번만 전진한다. 코드량은 비슷한데 **무효화가 정확해지고, C-4의 무한 증가가 사라진다**(키가 유계가 된다). B-6도 닫힌다.

**자리만 만들 것**

3. **`@CachePolicy` 데코레이터 + `APP_INTERCEPTOR` 1개** — mw 방식 그대로, 정책은 **3개면 된다**: `DAILY`(하루 1회 갱신 데이터) · `SHORT`(events·me) · `NONE`. 값은 `public, max-age=0, s-maxage=<초>, stale-while-revalidate=<5배>`. mw 주석이 기록한 함정 두 개를 그대로 가져온다 — *"max-age=0 명시 — CF가 max-age 없으면 4시간 기본값을 붙인다"*, *"must-revalidate는 stale-while-revalidate와 충돌"*. **비용 ~60줄. 지금 켜도 CF 룰이 없으면 CDN엔 안 먹지만 브라우저 왕복은 줄고, 나중에 CF 룰 하나로 켜진다.**
   에러 분기(`4xx/5xx → no-store`)를 같이 넣어라. **CDN이 404를 오래 잡고 있으면 오리진을 고쳐도 계속 404를 준다.**
4. **`fetchedAt`을 `Last-Modified`로.** 이미 `/api/open`·`/api/open/:bidNo` 응답에 실려 나가는데(`enrich`의 `...r` 스프레드, `:164`) **웹에서 grep 0회**다. 공짜로 있는 검증자다.
5. **CF 룰을 리포에 커밋** — mw의 `infra/cloudflare/*.json` 방식. 지금 우리 CF 설정은 **대시보드에만 있어 아무도 못 본다.** `/api/*`를 `bypass_by_default`(=오리진 `Cache-Control` 존중)로 두면 3번과 맞물린다.

**안 할 것**

6. **Redis · 머티리얼라이즈드 뷰 · nginx 캐시 어노테이션 · CDN purge 파이프라인.** 사용자 1명에 캐시 계층을 세우는 건 부채다 — 그리고 우리 도메인에서 캐시 무효화 실패는 **화면이 거짓말하는 경로**다. 그 사고를 이미 하나 갖고 있다(B-6). 층을 늘리면 그 종류가 는다.
7. **react-query 도입.** 데모만 쓰는 의존성이라 R7에서 **지운다.** 화면 간 중복 fetch(`/api/open` 3화면 · `/api/firms/bids` 3화면)는 react-query가 아니라 §7의 쿼리 수정과 3번의 캐시 헤더로 푼다. 브라우저 캐시가 곧 dedupe다.

**한 줄 요약: 우리 문제는 캐시가 없는 게 아니라 `/api/open`이 1+2N이고, 있는 캐시의 무효화 기준이 틀린 것이다. 그 둘을 고치고 CDN은 자리만 만든다.**

---

## 12. 라우트 상수

**사용자 지적이 맞다. 라우트 상수 파일은 없다** — `lib/routes.ts`·`paths.ts` 부재를 확인했다. 그런데 **상수화보다 급한 버그가 두 개 나왔다.**

### 12-1. 실제 버그 2건 — ROUTES를 기다리지 마라

**(가) 인코딩 없는 리다이렉트.** `app/dashboard/schools/[id]/page.tsx:3-5`
```
const { id } = await params;            // Next가 이미 디코드 → "김해시|임호초등학교"
redirect(`/dashboard/analysis/${id}`);  // 재인코딩 없이 경로에 다시 넣는다 → Location에 리터럴 |
```
이 경로는 `today/page.tsx:540`과 `wins/page.tsx:192`의 **목적지**다. 두 링크는 `encodeURIComponent`를 제대로 하는데(9곳이 한다) **그 다음 홉이 푼다.**

**(나) 이중 디코드.** `app/dashboard/analysis/[id]/page.tsx:11` — `decodeURIComponent(id)`. Next App Router가 `params`를 이미 디코드하므로 **두 번째 디코드**다. 보통은 무해하지만 **학교명에 `%`가 있으면 `URIError: URI malformed`로 화면이 죽고**, `%xx`처럼 보이는 문자열은 조용히 손상된다. 형제 라우트 `auction/[bidNo]/page.tsx:9`는 디코드를 **안 한다** — 같은 프레임워크 위에서 두 라우트가 다르게 판단했다.

### 12-2. 불일치 지도

| 값 | 인코딩함 | 안 함 |
|---|---|---|
| `schoolId` | 9곳 (`today:459,540`·`schools:119,199`·`wins:192`·`auction-detail:223,326,341,371`·`record:208,258`·`delivery:186,270`) | **`schools/[id]/page.tsx:5`** |
| `bidNo` | 쿼리스트링에선 5곳 | **경로에선 4곳** (`today:266,495`·`analysis-board:575,967`) |
| `/api/open/:bidNo` 호출 | `analysis-board.tsx:254` 인코딩 | `auction/[bidNo]/page.tsx:13` **raw** |
| `?sigungu=` 한글 | `wins:53,62` **URLSearchParams** | `today:156`·`schools:63` **생 문자열 결합** |
| `?bizNos=` | — | **전 지점 raw** (10곳) |

`today/page.tsx:177`은 한 줄 안에서 학교명은 인코딩하고 사업자번호는 안 한다.

### 12-3. `ROUTES` 도입 판정

**채택한다. 그리고 우리가 mw-auction보다 더 필요하다.**
- 그쪽 경로 파라미터는 `123-item-slug`(zod로 `^\d+` 강제)다. 우리는 **`"김해시|임호초등학교"`** — 파이프와 한글이 든 조립 문자열이다. 인코딩 실수의 확률과 대가가 다르다.
- **architect가 이 키를 `PURR_CD`로 바꾸는 걸 §5-3-14에서 검토 중이다.** 라우트가 한 파일에 모이면 그 전환이 **한 파일 수정**이 된다. 지금은 25곳이다.
- mw의 교훈도 있다: `PAGES`가 생긴 이유가 *"nav와 sitemap이 각자 목록을 들고 드리프트해 sitemap에서 `/database/mobs`·`/community`·`/s`가 조용히 빠졌다"*는 회귀다. 우리도 같은 모양이다 — `/dashboard/analysis/[id]`·`/dashboard/auction/[bidNo]`·`/welcome`·`/s/[token]`·`/dashboard/funnel`이 **어느 설정에도 없고** 흩어진 템플릿 리터럴로만 존재한다.

**규모:** `lib/routes.ts` ~60줄 + 호출 지점 25곳 치환(`href` 13 · `router.push` 7 · `redirect` 4 + API 경로). **위험 낮음**(기계적) · **파일 수 많음**(12+). mw처럼 `routes.spec.ts`(~20줄)로 목록을 고정하면 §10의 테스트 예산에도 맞는다.

---

## 13. 리팩터링 주간 실행 목록 (최종 · §5를 대체한다)

정렬 = **위험 × 빈도**. 사용자가 *"이걸 고친 후에 고도화해야 성숙해진다"*고 했으므로 뿌리부터 실었다.
표기: **규모** = 건드리는 파일 수 · **위험** = 상/중/하.

### 13-A. 지금 한다 — 동작 불변 (리팩터링)

| # | 작업 | 막는 것 | 규모 | 위험 |
|---|---|---|---|---|
| **R1** | `app.yaml:117` readiness 프로브를 `/dashboard/today`(또는 web `/healthz` 신설)로 교체 | **A-5 — R6의 전제. 안 하면 청소가 사이트를 내린다** | 1파일 1줄 | 하 |
| **R8** | `verdict()`·`effFloor()`·`normalizeBizNo()`를 `shared/src/domain/`으로 추출. **컨트롤러 위치 불변** | 판정 **8곳**(서버 5·웹 3) · effFloor 2 · bizNo 파서 4 → §7-2 | 4파일 | 하 |
| **R12** | **S-1 배선** — `/api/schools/:id/roster`가 `school_roster_cat`을, `enrich`가 `byCatFloor`를 읽게 한다. `catCounts`·`srcMix`를 응답에 싣는다 | **§7-0. 정답이 DB에 있는데 화면이 틀린 n을 쓴다.** SPEC-BATCH가 여기 막혀 있다 | 1파일 | 중(응답 추가) |
| **R13** | `/api/open` 1+2N → 3쿼리. `region`·`category`를 SQL WHERE로 | §7-1 · §11-2-1. 사용자 1명에서도 터진다 | 1파일 | 중 |
| **R14** | 인메모리 캐시 4개의 키를 TTL → `fetchedAt` | **B-6(캐시가 어제 값을 준다) + C-4(무한 증가)** 동시 해소 | 1파일 | 하 |
| **R15** | `/api/wins/monthly`·`/forecast`·`/wins/regions`에 날짜·HAVING 경계를 SQL로 | §7-1. 116,892행 전량 스캔 3곳 | 1파일 | 하 |
| **R16** | `GlobalExceptionFilter` 1개 + **인증 실패를 401로** | A-3의 절반 · §9 | 2파일 | 중 |
| **R6** | 죽은 라우트·feature·mock 삭제 (**R1 이후에만**) | D급 전량 · devDep 런타임 의존 | 대량 삭제 | 하(도달 불가 확인됨) |
| **R7** | 고아 의존성 제거 (react-query·zustand·recharts·dnd-kit·faker 등 20개) | 번들·설치 | 1파일 | 하 |
| **R4** | 알림센터를 헤더에서 분리(`header.tsx:31`) + `features/notifications` 제거 | **B-1 — 62세 사장 전 화면에 영어 목업** | 2파일 | 하 |
| **R5** | `layout.tsx:22-49` 메타데이터·OG · `:63` `lang='ko'` · `package.json` author | 스타터 정체성 노출 | 3파일 | 하 |
| **R3** | `reset-dev.sql:13` `workspace_biz` DROP 제거 **또는** `user-data.ts:1-4` 주석을 사실로 | B-2 규약 거짓 | 1파일 | 하 |
| **R10** | `SchoolSummary`·`OpenAuction` zod를 현재 테이블에 맞춤 | C-6 · **§5-2-9의 전제** | 2파일 | 하 |
| **R9** | `analysis-board.tsx` 발주 예보 삭제 → 서버 응답. **R14와 함께** | 사고 3 · 설계 0-1 · B-6 | 1파일 | 중 |
| **R17** | `app.module.ts` 954줄 → 도메인 8파일. **서비스 클래스·리포지토리 없이 컨트롤러만 이동** | §8-2 mw 자기 기준 위반 · 병합 충돌 | 9파일 | 중 |
| **R18** | `lib/routes.ts` + `ROUTES` + `routes.spec.ts`. **12-1 버그 2건은 먼저 따로** | §12 · architect의 `PURR_CD` 전환 대비 | 12+파일 | 하 |
| **R19** | spec 3개 + `check-schema-safety.sh` (`bun test`) | §10. ~115줄 | 4파일 | 하 |
| **R11** | `ssot-guard.mjs` — **검사 4개만**. `Sourced` 필드명을 `.v`에서 변경 | 설계 §6-2의 조기 죽음 | 2파일 | 하 |

**순서 제약: R1 → R6.** 그 외는 독립. **R8 → R19(verdict spec).** **R10 → (설계 §5-2-9).**

### 13-B. 미룬다

`Sourced<T>` 도입(§5-0 재파싱 뒤 — 안 그러면 화면이 62%를 말한 직후 숫자가 바뀐다) · `vocab/`·코드북(§5-0 측정 미완) · 브랜디드 `SchoolId`(R8·R18 뒤가 훨씬 싸다) · 웹 로컬 타입 23개→shared(**R10이 먼저**) · `data-plane/load_postgres.py` 삭제(배포 이미지 확인 필요) · 화면 중복 제거(R8이 서버에 착지한 뒤) · `@CachePolicy` 인터셉터(자리만 — 9/12 동결 전에 넣되 CF 룰은 관측창 후) · `escapeLike`

### 13-C. 안 한다

`gen:contract`+`_contract.py`(§4-1-가) · NestJS 서비스/리포지토리 3층(§3·§8-3) · `{data}` 응답 봉투(§8-4-1) · `schema.sql`을 drizzle에서 생성(§4-1-라) · 커버리지 **게이트**(§4-4) · `ssot-guard`의 `864e5`·`Math.floor(len/2)` 검사(§4-1-나) · 화면 키(`screen`) 이름 변경(관측창 9/15~9/30 전에 바꾸면 G1 무효) · Redis·머티리얼라이즈드 뷰·nginx 캐시(§11-2-6) · react-query 도입(§11-2-7) · `timeout`/`singleflight`/`deadlock-retry`/`safe-cron`/가드/WS 필터(§9) · `MODULE_MAP.md`(§8-4-3) · 계약 스냅샷 테스트(§10) · 파이프라인 TS 재작성·CI 구축

### 13-D. 동작 변경 — 리팩터링이 아니다. 승인 필요

| # | 제안 | 근거 | 판정 |
|---|---|---|---|
| ~~X1~~ | ~~`open_auctions` 삭제 차단~~ | | **닫힘** `6d91978` |
| ~~X3~~ | ~~CronJob `;`→`&&`~~ | | **닫힘** `6d91978` |
| **X4** | 인증 실패 **401** + `session.ts:100` `res.ok` 검사 + 실패 고지 | **A-3 — 지금 사장이 친 값이 사라질 수 있다** | **즉시** (R16과 함께) |
| **X13** | `fetch_open.py` — 수집 건수가 직전 대비 급감하면 **비영 종료**. `:58-59`의 `except: pass`에 카운터 | X1이 잘린 JSON은 막지만 **"짧지만 유효한 JSON"은 통과한다** | 즉시 |
| **X2** | `fetch_open.py:64` temp+rename (`archive.py:40-43` 패턴) | 원자성. X13과 짝 | 즉시 |
| **X6** | `session.ts:149`의 `?? '1'` 제거 | C-3 공용 PC 교차 오염 | 즉시 |
| **X12** | `forecastCache`·`monthlyCache` 상한 | C-4 — **R14가 하면 자동 해소** | R14에 흡수 |
| **X15** | `schools/[id]/page.tsx:5` 인코딩 · `analysis/[id]/page.tsx:11` 이중 디코드 제거 | **§12-1 실제 버그 2건. 2줄** | 즉시 |
| **X5** | 마크 저장을 전량 치환 → 단건 PATCH | A-4 두 탭 클로버 | 승인 필요(API 계약) |
| **X7** | `bizNos`·`regions` 파싱 실패에 마크와 **같은** 정책 | C-2 비대칭 | 승인 필요(UX 추가) |
| **X8** | `/api/open` 6곳이 `?region=`을 넘기고 `allowedLabel`·`unrestricted`를 읽는다 | B-5 | 승인 필요(**보이는 공고 수가 바뀐다**) · R13과 함께 |
| **X9** | `firms/bids` limit 통일 + 화면이 캡을 말한다 | B-4 · U27 재발 | 승인 필요 |
| **X14** | `bizNos`를 쿼리스트링에서 헤더·바디로 | **§9-1 — 사업자번호가 URL·액세스로그·CF로그에 남는다** | 승인 필요. 사용자 늘기 전이 싸다 |
| **X10** | U38 오염값(`9006`·`8807`) 마이그레이션 | §5-5와 충돌 | **사장 판정** |
| **X11** | `clean_inst` 괄호 절단을 정상 이름/주소 오염으로 분리 | C-5 — 서로 다른 수요기관이 합쳐진다 | 승인 필요(학교 목록이 바뀐다) |
