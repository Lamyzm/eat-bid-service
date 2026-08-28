# ARCH-DELIVERY — 배포·공급망 설계

**작성 2026-08-28.** 권고다. 선택지 나열이 아니다.

**스택 고정: Windows · Cloudflare · ArgoCD · GitHub · Docker.** 이 밖의 것은 안 끌어왔다.
(R2는 Cloudflare, GHCR·Actions는 GitHub다 — 스택 안이다.)

관련 규칙: `.claude/rules/changing-and-verifying.md`(C1·C3·C5·C7) · `failing-loudly.md`(F1).
이 설계는 그 둘을 배포 계층으로 확장한 것이다.

**읽는 순서:** §0(실측) → §1(이 문서의 중심 질문, 이게 목차다) → 나머지.

---

## §0. 전제 — 리포를 읽다가 나온 것 넷

리더가 준 사실은 다시 재지 않았다. `infra/`·`Dockerfile*`·`tools/`·`.githooks/`를 읽다가 **설계를 바꾸는 것 넷**이 나왔다.

### 0-1. 🔴 `update_lake.py`가 `EATBID_DATA_ROOT`를 무시한다 — daily-refresh의 절반이 매일 조용히 버려진다

```
tools/bidboard/fetch_open.py:21   DATA = os.environ.get("EATBID_DATA_ROOT", ...)   ← 따른다
tools/serve/load_postgres.py:11   DATA = os.environ.get("EATBID_DATA_ROOT", ...)   ← 따른다
tools/bidboard/update_lake.py:20  paths = Paths(Path(BASE) / "data")               ← 무시한다
tools/bidboard/backfill.py:25     paths = Paths(Path(BASE) / "data")               ← 무시한다
```

`daily-refresh`는 `EATBID_DATA_ROOT=/lake`를 주고 `/lake`만 마운트한다. 그러면 `update_lake.py`는 `crawl_range` → `write_raw(paths.raw_dir)`·`write_batch(paths.parquet_dir)`를 **`/app/data`** 에 쓴다. 마운트가 없는 **컨테이너 로컬**이다.

| 결과 | |
|---|---|
| 개찰분 증분이 레이크에 안 들어간다 | 매일 크롤해서 파드와 함께 버린다 |
| `CrawlState` 재개가 클러스터에서 작동한 적이 없다 | `state.sqlite`도 `/app/data`라 매일 버려진다 — **16개 시도 × 35일을 매일 처음부터 다시 받는다** |
| 아무도 실패를 보고하지 않는다 | `update_lake.py`는 **정상 종료**한다. `&&` 사슬이 통과한다 |

**C1의 교과서적 재현이다.** `fetch_open.py`는 이 함정을 고쳤고 21행에 *"이걸 무시하고 BASE/data 에 쓰면 컨테이너에서…"* 라고 **경고 주석까지 달아놨다.** `update_lake.py`만 안 고쳤다 — `e19f880`이 시도 코드에서 같은 파일 하나를 빠뜨린 것과 **같은 파일, 같은 형태**다.

> **왜 안 터졌나.** 레이크를 실제로 채우는 건 호스트에서 도는 로컬 도커 백필 3개다(`docker-compose.yml`이 `./data:/data`). 클러스터의 `update_lake`는 잉여 중복 경로다. `F:/Project/eat-bid/data`(2.7GB)와 `/lake`(2.7GB)의 크기가 일치하므로 후자는 전자의 마운트로 읽힌다 — **추정이고, 확인은 §9의 한 줄이다.**

**§8이 이 수정을 선행 조건으로 깐다.** 안 고치고 백필을 Job으로 옮기면 40시간 크롤이 파드 로컬 디스크에 쌓였다가 통째로 사라진다.

### 0-2. `k3d cluster create`가 두 리포 어디에도 없다

전부 뒤졌다. `k3d`가 나오는 곳은 `rules/changing-and-verifying.md`의 `k3d image import` 예시뿐이고 **클러스터 생성 명령은 한 번도 안 나온다.** 그 명령이 아는 것들이 셸 히스토리에만 있다:

| 잃어버린 것 | 근거 |
|---|---|
| 로드밸런서 포트 매핑 | `app.yaml`이 `BETTER_AUTH_URL: http://localhost:8081` — **8081이 어디서 왔는지 리포에 없다** |
| `/lake` hostPath를 노드에 넣는 `-v` | `app.yaml`·`poll.yaml`이 `hostPath: /lake`를 4곳에서 쓰는데 **호스트 어디에 붙는지 리포에 없다** |
| k3s 버전 | 실측 `rancher/k3s:v1.35.5-k3s1`. 리포엔 없다 |

**스키마 적용이 사람 기억에 의존해 물린 것(C3)과 같은 형태다.** 그때는 *"안 터진 건 누가 손으로 psql을 돌렸기 때문이고 그 기록이 리포에 없다"* 였다. 지금은 *"클러스터가 서 있는 건 누가 손으로 만들었기 때문이고 그 기록이 리포에 없다"* 다.

### 0-3. 이 호스트의 cloudflared는 **quick tunnel**이다 — 재사용할 자산이 없다

```
arcawiki-quicktunnel   cloudflare/cloudflared:latest   Up 11 days
~/.cloudflared/        → 없음
```

다른 프로젝트(arcawiki)의 것이고 **quick tunnel**이다. Cloudflare 문서가 명시한다 — 재시작마다 `*.trycloudflare.com` 호스트명이 바뀌고, 영구 자격증명이 없고, 프로덕션 부적합이다. **`~/.cloudflared/`가 비어 있으므로 named tunnel 자격증명도 이 기계에 없다.** §5는 맨바닥에서 시작한다.

### 0-4. `data-plane/load_postgres.py`가 리포에 하나 더 있다 — 105행짜리 화석

| | 행 수 | 최종 커밋 |
|---|---|---|
| `eat-bid-service/data-plane/load_postgres.py` | **105** | `5bc05bd` 2026-08-27 (그 뒤 손댄 적 없음) |
| `eat-bid/tools/serve/load_postgres.py` | **575** | `b936a99` 2026-08-28 (어제 버그 수정) |

도는 건 뒤엣것이다. 앞엣것은 **아무 Dockerfile도 COPY하지 않는 죽은 파일**이다. 지금은 무해하지만, 위험한 건 **다음에 로더를 고치러 온 사람이 서비스 리포에서 grep해 이걸 찾는 것**이다 — 정확히 C1이 막으려는 사고다. §2의 합병이 같이 지운다.

---

## §1. 이 문서의 중심 질문

리더의 말이 이 설계의 전제다:

> *"다른 컴퓨터이긴 하지만 VMware 나 Docker 를 사용할 것이기에 **여기서 배포되면 거기서도 배포될 듯**"*

**맞다. 단, 지금은 성립하지 않는다.** Docker/k3d 추상이 같다는 건 참이지만, **그 추상 위에 올릴 것들이 이 기계 밖에 없다.** 이 문서 전체가 그 목록을 참으로 만드는 작업이다.

### 성립 조건 — 이게 이 문서의 목차다

| # | 지금 이 기계에만 있는 것 | 새 기계에서 어떻게 얻나 | 절 | 없으면 |
|---|---|---|---|---|
| 1 | 이미지 3개 (k3d 노드 컨테이너 안) | **GHCR pull** | §3 | 전부 재빌드 — 재현 보장 없음 |
| 2 | 파이썬 코드가 ArgoCD 밖 | **리포 합병** | §2 | 파이썬 푸시가 클러스터에 안 닿음 |
| 3 | 테스트 (`.githooks/` 미커밋) | **커밋 + CI** | §4 | **새 기계엔 테스트가 존재하지 않음** |
| 4 | 클러스터 생성 명령 (셸 히스토리) | **`infra/k3d.yaml`** | §9 | 클러스터가 안 섬 |
| 5 | Secret 2개 (손으로 만듦) | **`.env.bootstrap` + 게이트** | §6 | 인증이 **조용히** 깨짐 |
| 6 | 외부 노출 (없음 — `localhost:8081`뿐) | **named tunnel, git 안** | §5 | 사장이 못 씀 |
| 7 | **raw 2.2GB / 219,487 파일** | **R2 스냅샷** | §7 | ❌ **복구 불가** |
| 8 | 백필 상태 sqlite 4개 | **R2 스냅샷 (정지 시점)** | §7 | 백필이 처음부터 |
| 9 | 백필 실행 (호스트 `docker run`) | **Argo Job** | §8 | 이 기계에 묶인 채 남음 |

**7·8이 유일하게 "다시 만들 수 없는" 항목이다.** 나머지 일곱은 전부 절차·설정이고, 잃어도 시간만 든다. §7을 가장 길게 썼다.

---

## §2. 리포 구조 — **합친다**

### 결정

`eat-bid`(파이썬)를 `eat-bid-service/data-plane/`으로 **git 히스토리째 이식**한다. 화석(§0-4)은 그 이동으로 대체된다. `eat-bid` 리포는 아카이브(삭제 아님).

```
eat-bid-service/                    (단일 리포, master)
  apps/server · apps/web · packages/shared
  data-plane/                       ← eat-bid 전체
    src/eatbid/ · tools/ · scripts/ · tests/ · Dockerfile · .dockerignore
  infra/k3d.yaml                    ← 신설 (§9)
  infra/k8s/base/                   ← ArgoCD가 보는 곳
  infra/k8s/backfill/               ← 신설 (§8)
  .github/workflows/                ← 신설 (§4)
```

### 근거 — ArgoCD가 파이썬을 보게 하는 **가장 싼 길**이 이것이다

후보는 셋뿐이다:

| 방법 | 비용 | 판정 |
|---|---|---|
| Application 2개 | 파이썬 리포에도 `infra/` 신설 + Application 등록 + 브랜치 정합(`master`/`phase1-collection`) | ❌ 영구 비용이 붙는다 |
| 다중 소스 Application 1개 | Argo 설정 1회 | ❌ 아래 |
| **합병** | 일회성 2시간 | ✅ |

**다중 소스는 여기서 답이 아니다.** Argo 문서가 *"서로 무관한 애플리케이션을 묶는 일반적 방법이 아니다"* 라 명시하고, **모든 소스가 매 sync마다 함께 처리돼 개별 sync가 불가능하다.** 우리 경우 그건 합치는 것과 같은 결합도인데 **리포만 둘로 남는다** — 최악의 조합이다.

### 그 외 근거 셋

**① 스탬프 대조가 하나로 줄어든다.** C7의 장치는 *"도는 코드가 방금 만든 코드인가"* 에 **답이 하나**라는 전제 위에 선다. 지금은 SHA가 둘이고 브랜치까지 갈려 있다. 합치면 **파드 셋의 `BUILD_SHA`가 같은 커밋을 가리켜야 한다**는 검사가 성립한다 — 안 맞으면 그 자체가 신호다. 두 리포에서는 이 문장을 쓸 수조차 없다.

**② 계층을 가로지르는 수정이 grep 하나로 닫힌다.** `rules/README.md`가 직접 적었다 — *"이번 주 사고 대부분이 계층을 가로질렀다 — 지역은 수집기·로더·서버·웹 네 곳."* 그 **네 곳 중 셋이 파이썬, 하나가 TS**다. 지금 grep은 리포 경계에서 멈춘다. 진행 중인 코드북 작업도 같은 모양이다.

**③ §4(CI 하나)·§8(경로 하나)의 전제다.**

### 비용

| 항목 | 비용 |
|---|---|
| 이식 (`git subtree add --prefix=data-plane`) | `.git` 689K·커밋 22개 → **1시간** |
| `data/` 2.7GB | **안 따라온다** — `.gitignore`에 `data/` |
| 훅 통합 | §4에서 같이 — **1시간** |

**⚠ 유일한 실질 위험 — 빌드 컨텍스트 오염.** C7이 기록한 두 사고 중 하나가 **`.dockerignore` 부재로 컨텍스트가 오염돼 빌드가 "성공했는데 내용이 낡은" 것**이었다.

처방 셋, 전부 넣는다:
- **컨텍스트를 `data-plane/`으로 좁힌다** — `context: ./data-plane`, `file: ./data-plane/Dockerfile`. Dockerfile의 `COPY src/ ./src/`가 그대로 맞는다. **수정 0줄**이고, 부수적으로 `node_modules` 문제 자체가 사라진다
- `data-plane/.dockerignore` — `data/`·`.venv/`·`__pycache__/`·`.pytest_cache/`·`tmp_*.txt`·`scratch_*.txt`. ⚠ 파이썬 리포 루트에 `tmp_*`·`scratch_*`가 **24개** 있고 지금 전부 이미지에 들어가고 있다
- **`BUILD_SHA` 스탬프가 이 사고를 탐지한다**(§3)

### 안 하면 무엇이 깨지나

- 파이썬 푸시가 클러스터에 안 닿는 현재 상태 유지 (성립 조건 #2)
- 스탬프 대조가 dataplane에 **성립하지 않는다** — 세 이미지 중 하나가 검증 밖
- 다음 코드북 수정이 §0-1과 같은 형태로 한 곳을 빠뜨린다

---

## §3. 이미지 공급망 — **GHCR + 불변 태그 + CI가 매니페스트를 커밋**

### 결정

| 항목 | 결정 |
|---|---|
| 레지스트리 | **GHCR** — `ghcr.io/lamyzm/eatbid-{web,server,dataplane}` |
| 태그 | **`:$GIT_SHA` 불변 태그** (+ 사람용 `:latest`) |
| `imagePullPolicy` | **`IfNotPresent` 유지** — 바꾸지 않는다 |
| Argo가 갱신을 아는 법 | **CI가 `kustomization.yaml`의 `images:`를 커밋** |
| `k3d image import` | **없앤다** |

### 근거 — 레지스트리는 **이전 때문에** 필요하다

동시 운영(§10-2)은 요구가 아니다. 그래도 레지스트리는 필요하다 — **`k3d image import`가 이 기계 안에서만 되는 동작이기 때문이다.** 새 기계에서 이미지를 어디선가 받아와야 하고, 받아올 곳이 지금 없다.

GitHub이 스택에 있으므로 **GHCR이 기본값**이고, 그걸 뒤집을 이유가 없다. k3d 내장 레지스트리·로컬 `registry:2`는 **노드/기계와 함께 죽어 지금 문제를 이름만 바꿔 재현**하고, 백업해야 할 상태를 하나 더 만든다.

비용: **현재 무과금.** GHCR 스토리지/egress는 아직 과금되지 않으며 GitHub이 30일 사전 고지를 약속했다. 과금돼도 이미지 3개는 무시할 수준이고, 후퇴는 매니페스트의 이미지 접두어 한 줄이다 — **되돌리기 쉬운 결정이다.**

### 근거 — 불변 태그가 `IfNotPresent`를 **고친다**

지금 사고 구조는 `:dev`(가변) × `IfNotPresent`(캐시 우선)의 곱이다. 흔한 처방인 `imagePullPolicy: Always`는 **틀린 처방이다** — 태그가 여전히 가변이라 "지금 pull한 게 내가 만든 것인가"에 답이 없고 무의미한 pull만 는다.

**옳은 처방은 태그를 불변으로 만드는 것이다.** 그러면 `IfNotPresent`가 **비로소 옳아진다** — 같은 태그는 정의상 같은 내용이므로 캐시가 정확하다. 정책을 안 건드리고 원인을 없앤다.

C7이 이 선택을 검토하고 **비용 때문에 보류**했다:

> *"불변 태그가 정석이지만 `app.yaml`이 태그를 하드코딩하고 있어 매 배포마다 매니페스트를 고쳐 푸시해야 한다 — **ArgoCD 흐름과 싸운다.**"*

**그 비용은 CI가 생기면 사라진다.** 사람이 아니라 CI가 고친다:

```yaml
# infra/k8s/base/kustomization.yaml — CI가 이 블록만 다시 쓴다
images:
  - { name: eatbid-web,       newName: ghcr.io/lamyzm/eatbid-web,       newTag: a1b2c3d }
  - { name: eatbid-server,    newName: ghcr.io/lamyzm/eatbid-server,    newTag: a1b2c3d }
  - { name: eatbid-dataplane, newName: ghcr.io/lamyzm/eatbid-dataplane, newTag: a1b2c3d }
```
```bash
kustomize edit set image eatbid-web=ghcr.io/lamyzm/eatbid-web:$SHA
```

그리고 이 방식은 ArgoCD 흐름과 **싸우지 않고 맞는다** — 클러스터 상태가 git에 있다는 게 GitOps의 정의고, 지금은 `:dev` 뒤에 뭐가 있는지 git이 모른다.

**부수 효과가 크다: `git log infra/k8s/base/kustomization.yaml`이 배포 이력이 된다.** "언제 무엇이 배포됐나"에 처음으로 기록이 생긴다.

### Image Updater를 **안 쓴다**

*"없는 문제를 풀지 마라"* 판정. Image Updater가 요구하는 것 — 컨트롤러 파드, 레지스트리 자격증명, **git write-back 자격증명**, 브랜치 추적 — 중 마지막 둘을 **CI가 이미 갖는다**. `write-back-target: kustomization`을 쓰면 결과물도 사실상 같다. **같은 결과에 컴포넌트만 하나 더다.**

> **Image Updater는 CI가 없을 때 CI를 대신하는 도구다. §4에서 CI를 만든다.**
> **재검토 조건:** 이미지가 5개를 넘거나, CI 밖에서 태그가 갱신되기 시작하면.

### ⚠ 같이 넣을 것 셋

**① CI 커밋 루프 차단.** CI가 자기 리포에 커밋하면 CI가 또 돈다. `paths-ignore: [infra/k8s/**]`가 1차 방어, 커밋 메시지 `[skip ci]`는 보조.

**② dataplane에도 `BUILD_SHA`를 단다.** 지금 web·server에만 있다. 스탬프 없는 이미지가 하나 남으면 "셋이 같은 SHA인가" 검사가 성립하지 않는다.
```dockerfile
ARG GIT_SHA=unknown
ENV BUILD_SHA=$GIT_SHA
```
CronJob/Job 파드는 짧게 살아 `kubectl exec`이 어렵다 → **시작 시 `BUILD_SHA`를 로그 첫 줄에 찍는다.** 그게 dataplane의 스탬프 대조 경로다.

**③ private GHCR은 `imagePullSecret`이 필요하다** — §6의 세 번째 비밀. 없으면 `ImagePullBackOff`로 **시끄럽게** 실패한다(다행이다).

### 비용

GHCR 개설 + PAT + `imagePullSecret` **20분** · 매니페스트 이미지 이름 6곳 **20분** · `images:` 블록 **10분** · dataplane 스탬프 **10분**.

---

## §4. CI — **GitHub Actions 클라우드 러너. 셀프호스티드 불필요**

### 결정

`.github/workflows/build.yml` 하나, **GitHub 호스티드 `ubuntu-latest`**. 셀프호스티드 러너는 **쓰지 않는다.**

### 근거 — 셀프호스티드가 필요 없는 이유

셀프호스티드가 필요한 건 **러너가 클러스터·사내망에 직접 닿아야 할 때**다. §3이 그 필요를 없앴다:

```
[GitHub 클라우드 러너] --push--> [GHCR] <--pull-- [k3d 클러스터]
                       --commit-> [master] <--watch-- [ArgoCD]
```

러너는 클러스터를 **모른다.** 이미지를 밀고 매니페스트를 커밋하면 끝이고, 반영은 ArgoCD가 pull 방향으로 한다. **러너가 클러스터에 닿을 필요가 원리적으로 없다.** 프라이빗 리포도 로컬 클러스터도 이 그림을 안 막는다 — 프라이빗은 GHCR pull secret(§6)로, 로컬은 pull 방향이라 인바운드가 필요 없다.

**그리고 셀프호스티드는 우리가 없애려는 것을 되만든다.** §1의 표 전체가 "이 기계에 묶인 것"의 목록인데, 셀프호스티드 러너는 **빌드를 다시 이 기계에 묶는다** — 새 기계에서 러너를 다시 설치·등록해야 하고, 그 기계가 꺼져 있으면 CI가 안 돈다. Windows 호스트라 러너 환경이 Linux 컨테이너 빌드와 어긋나는 문제까지 붙는다.

**비용도 문제가 아니다.** 프라이빗 리포 무료 한도가 **월 2,000분(Linux)**. 이미지 3개 × ~6분 = 회당 ~18분 → **월 100회 이상**. 1인 프로젝트에서 닿지 않는다. `cache-from: type=gha`로 더 준다.

> **`mw-auction/.github/workflows/build-images.yml`이 검증된 선례다** — 같은 계정, 같은 프라이빗 조건, 이미지 3개, GHCR, `docker/build-push-action@v6` + gha 캐시. 그대로 가져오되 **알림 스텝의 `|| true`는 가져오지 마라** (F1 위반이고 우리 리포에선 규칙 위반이다).

### `.githooks/` 와 CI — **같은 테스트를 두 번 정의하지 않는 법**

**원칙: 테스트 정의는 한 곳에 산다. 훅과 CI는 둘 다 그 한 줄을 호출한다.**

지금 상태는 반쯤 그렇다:

| | 지금 | 판정 |
|---|---|---|
| `pre-push` | `pnpm test` | ✅ 정의는 `package.json`에 있고 훅은 호출만 한다 |
| `pre-commit` | `pytest tests/ -q --no-header -x` | ❌ **플래그가 훅에 박혀 있다.** CI가 같은 걸 쓰려면 복붙해야 하고, 그 순간 두 정의가 갈린다 |

**처방:**
```
data-plane/pyproject.toml   [tool.pytest.ini_options] addopts = "-q --no-header -x"
package.json                "test": "bun test ...", "test:py": "pytest data-plane/tests"
.githooks/pre-commit        pnpm test:py          ← 플래그 없음
.githooks/pre-push          pnpm test
.github/workflows/build.yml pnpm test && pnpm test:py   ← 같은 명령
```
훅과 CI가 **같은 문자열**을 호출한다. 플래그를 바꾸면 한 곳만 바꾼다 — C1의 형태를 미리 막는 것이다.

**⚠ 딱 한 곳은 달라야 한다 — 그리고 그게 중요하다.**

`pre-commit`에 이 분기가 있다:
```sh
if [ ! -x "$PY" ]; then
    echo "pre-commit: .venv 를 못 찾았다 — 테스트를 건너뛴다"
    echo "            (건너뛴 채로 커밋되는 것이 조용한 실패다. venv 를 만들 것)"
    exit 0
fi
```
훅이 **스스로 이게 조용한 실패라고 적어놨다.** 로컬 훅에서는 타협으로 받아들일 수 있다. **CI에서는 절대 안 된다** — CI는 venv가 없으면 **실패해야** 한다.

그리고 이게 성립 조건 #3의 실체다: **새 기계에는 `.venv`가 없다 → 새 기계의 첫 커밋들은 전부 조용히 무검증이다.** 훅이 미커밋이라 `core.hooksPath` 설정도 사람이 기억해야 한다 — C3가 물린 그 구조.

**훅은 없애지 않는다. 둘 다 둔다** — 훅은 빠른 피드백(로컬 10초), CI는 강제(우회 불가). 대신 **훅을 커밋하고** `bootstrap.sh`가 `core.hooksPath`를 설정한다.

### 무엇을 돌리나

| 잡 | 내용 |
|---|---|
| `test` | `pnpm test` + `pnpm test:py` |
| `build-{web,server,dataplane}` | GHCR push, `:$SHA` + `:latest`, `--build-arg GIT_SHA` |
| `bump` | `kustomize edit set image` × 3 → commit → push |

### 비용

워크플로우 이식 **반나절** · 훅 정리·커밋 **1시간** · 러너 **₩0**.

---

## §5. 외부 노출 — **named tunnel을 클러스터 안에. Access는 켠다**

### 결정

| 항목 | 결정 |
|---|---|
| 터널 종류 | **named tunnel** (quick tunnel 아님) |
| 어디에 | **클러스터 안 Deployment** (호스트 아님) |
| 무엇을 가리키나 | **기존 Ingress** (서비스별 아님) |
| 접근 통제 | **Cloudflare Access 켠다** — 조건부로 끈다 |
| `localhost:8081` | **유지** — 로컬 개발용 |

### 근거 — quick tunnel은 못 쓴다

§0-3에서 확인했다: 이 호스트의 `arcawiki-quicktunnel`은 **quick tunnel**이고 `~/.cloudflared/`는 비어 있다. **재사용할 자산이 없다.** 그리고 quick tunnel은 우리 용도에 원리적으로 안 맞는다 — 재시작마다 호스트명이 바뀌고(사장에게 URL을 다시 알려줘야 한다), 영구 자격증명이 없고, **Access를 걸 수 없고**, Cloudflare가 프로덕션 부적합이라 명시한다.

### 근거 — 왜 **클러스터 안**인가

**이게 이 절의 핵심 판단이다.**

| | 호스트 cloudflared | **클러스터 안 Deployment** |
|---|---|---|
| 어디에 기록되나 | 이 기계의 설정 파일 / 도커 명령 | **git** |
| 새 기계에서 | 손으로 다시 만든다 | **ArgoCD가 세운다** |
| 자격증명 | 호스트 파일 | Secret (§6) |
| 성립 조건 #6 | ❌ | ✅ |

**호스트에 두면 "손으로 만든 미기록 자산"이 이 기계에 하나 더 생긴다 — 이 문서 전체가 없애려는 바로 그것이다.** §1의 표에 열 번째 줄을 추가하는 셈이다. 클러스터 안에 두면 매니페스트가 git에 있고 부트스트랩이 재현한다.

Cloudflare 문서도 애플리케이션 옆의 별도 deployment를 권한다(애플리케이션과 독립적으로 스케일 가능). 우리는 스케일이 이유가 아니라 **재현성**이 이유다.

### 근거 — 왜 **Ingress를 가리키나**

`app.yaml`에 이미 Ingress가 있고 라우팅이 거기 있다:
```
/api  → server:80
/     → web:80
```

cloudflared의 자체 `ingress:` 규칙으로 서비스를 하나씩 노출할 수도 있다. **그러면 라우팅 진실이 두 곳이 된다** — 서비스를 추가할 때 Ingress와 tunnel config를 **둘 다** 고쳐야 하고, 한쪽을 빠뜨리는 게 정확히 C1이다.

**cloudflared는 Ingress 컨트롤러 하나만 가리킨다:**
```yaml
# tunnel config (ConfigMap)
ingress:
  - service: http://traefik.kube-system.svc.cluster.local:80
```
k3s 기본 Ingress 컨트롤러가 traefik이다(`rancher/k3s:v1.35.5-k3s1` 실측). **라우팅은 계속 `app.yaml`의 Ingress 하나가 진실이다.**

### 근거 — Access를 **켠다**

**켜는 이유:**
- 앱 자체 인증(Better Auth)이 아직 완성이 아니고, §6에서 보듯 `optional: true` 때문에 **조용히 꺼질 수 있다.** Access는 앱 **밖**에서 막으므로 **앱 인증 버그가 노출로 이어지지 않는다** — 두 겹이 필요한 이유는 F1이 이미 적었다(*"두 겹이면 한쪽만 고쳐선 안 잡힌다"*)
- 무료 티어 50명. 우리는 2명(나 + 사장). **₩0**
- 이메일 기반 정책 하나면 된다 — 사장 이메일 + 내 이메일

**끄는 조건 (기록해둔다):** 앱 인증이 실제로 돌고, 사장이 매번 두 번 로그인하는 게 실제 부담이 됐을 때. **그때 끄되, "끈다"가 결정이라는 걸 커밋 메시지에 남긴다.** 지금 끄면 그건 결정이 아니라 누락이다.

### ⚠ 터널을 열면 **반드시 같이 깨지는 것**

```yaml
# app.yaml
- { name: BETTER_AUTH_URL, value: "http://localhost:8081" }   # ← 터널 뒤에서 틀린 값
```

OAuth 콜백이 `localhost:8081`로 간다. **터널 호스트명으로 바꿔야 하고, Google OAuth 콘솔의 승인된 리디렉션 URI도 같이 고쳐야 한다.** 이건 조용히 안 깨지지만(로그인이 실패한다) **터널을 여는 커밋과 같은 커밋에서 고쳐야 한다** — 나눠 하면 "터널은 열었는데 로그인이 안 되는" 상태가 생기고 원인이 두 곳이 된다.

### 비용

named tunnel 생성 + 토큰 → Secret **30분** · cloudflared Deployment + ConfigMap 매니페스트 **1시간** · Access 정책 **20분** · `BETTER_AUTH_URL` + Google 콘솔 **30분**.

### 안 하면

사장이 서비스를 못 쓴다. `localhost:8081`은 이 기계 앞에 앉은 사람만 쓸 수 있다.

---

## §6. Secret — **문서화된 수동 절차 + 부트스트랩 게이트**

### 결정

값을 `.env.bootstrap`(gitignore) 하나로 옮기고, `bootstrap.sh`가 읽어 Secret 4개를 만든다. **없으면 멈춘다.** SealedSecrets·SOPS는 **안 쓴다.**

| Secret | 키 | 출처 |
|---|---|---|
| `eatbid-share` | `EATBID_SHARE_SECRET` | 기존 |
| `eatbid-auth` | `BETTER_AUTH_SECRET` · `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | 기존 |
| `ghcr-pull` | `.dockerconfigjson` | **신설** — GitHub PAT (§3) |
| `cloudflared-token` | `TUNNEL_TOKEN` | **신설** — Cloudflare (§5) |

**GitHub과 Cloudflare만 쓰면서 어떻게 옮기나 — 답: 그 둘이 값의 *출처*다.** GHCR PAT는 GitHub에서 재발급하고, 터널 토큰은 Cloudflare 대시보드에서 다시 본다. **이 둘은 사실 "옮기는" 게 아니라 "새 기계에서 다시 받는" 것이다.** 손으로 옮겨야 하는 건 앞의 둘(share·auth)뿐이고, 그것도 전부 재발급 가능하다.

### 근거 — 봉인 도구를 안 쓰는 이유

| 도구 | 얻는 것 | 내는 것 |
|---|---|---|
| SealedSecrets | 암호문을 git에 | 컨트롤러 파드 + **봉인 개인키.** 잃으면 모든 봉인 비밀을 못 푼다 → **백업할 비밀이 하나 더 는다** |
| SOPS + age | 암호문을 git에 | age 키 파일. **새 기계로 손으로 옮겨야 한다** |
| **수동 + 게이트** | — | 값 몇 개를 손으로 옮긴다 |

**둘 다 "새 기계로 비밀 하나를 손으로 옮긴다"를 없애지 못한다. 옮길 대상 수만 줄인다.** 그리고 그 1개는 **잃으면 복구 불가**인 반면 지금 값들은 **전부 재발급 가능**하다. 1인 규모에서 이 교환은 손해다.

**진짜 위험은 암호화가 아니라 빠뜨림이다.** 지금 `app.yaml` 주석이 생성 명령을 담고 있는데 그건 사람이 읽고 실행해야 한다 — C3가 물린 구조. **답은 암호화가 아니라 자동 검사다.**

### ⚠ 지금 `app.yaml`에 조용한 실패가 있다

```yaml
- name: BETTER_AUTH_SECRET
  valueFrom:
    secretKeyRef: { name: eatbid-auth, key: BETTER_AUTH_SECRET, optional: true }   # ← 이것
```

**`optional: true`는 F1 위반이다.** Secret이 없으면 파드가 **정상적으로 뜨고 인증만 조용히 망가진다.** `?? 기본값`과 같은 모양 — 규칙이 이미 이름 붙인 것이다.

**새 기계 부트스트랩에서 정확히 이게 터진다:** Secret 주입을 빠뜨려도 클러스터가 **초록으로 통과**하고, 사장이 로그인할 때 처음 드러난다.

> **권고: `optional: true` 셋을 뗀다.** 그러면 Secret이 없을 때 `CreateContainerConfigError`로 **시끄럽게** 멈춘다.
> ⚠ 단, 인증 미구현 기간에 파드를 띄우려 **의도적으로** 붙였을 수 있다. 그 시기가 끝났는지 확인 후 뗀다.

### 비용

`.env.bootstrap.example`(키 이름만) **20분** · 게이트(하나라도 비면 `exit 1`) **30분** · `optional: true` 제거 **10분** · 값 이전 5분.

### 재검토 조건

**좌석이 둘 이상 되거나 클러스터가 둘 이상 되면 SOPS로 간다.** 그때 "손으로 옮긴다"의 곱셈이 시작되므로 교환이 뒤집힌다.

---

## §7. 🔴 데이터 — **이게 제일 어려운 문제가 맞다**

리더가 옳다. 그리고 **실측이 리더의 우려보다 상황을 더 나쁘게 만든다.**

### 7-1. 무엇이 대체 불가능한가

| 대상 | 크기 | 재생성 | 비용 |
|---|---|---|---|
| 이미지 3개 | — | ✅ CI 재빌드 | 6분 |
| Postgres `firm_bids` 913만 행 | 2Gi PVC | ✅ 레이크에서 로더 재실행 | ~16분 |
| 레이크 parquet | 389M + 164M | ✅ raw에서 재파싱 | 시간 단위 |
| **raw XML** | **2.2GB / 219,487 파일** | ❌ **eaT에서만** | ⬇ 7-2 |
| **상태 sqlite 4개** | 12MB | ❌ 잃으면 백필 처음부터 | ⬇ |

**아래 둘만이 진짜 자산이다.** 위 셋은 아래 둘의 함수다.

### 7-2. 재수집 비용은 **선형이 아니다** — 소스가 저항한다

리더가 *"40시간이 아니라 훨씬 길다"* 고 했다. **왜 그런지가 `crawl-guard.json`에 기록돼 있다:**

| 시각 | 워커 | 트립 사유 | 지연 배수 |
|---|---|---|---|
| 08:00 | — | p90 2.23s (기준 0.98s) | 2.0× |
| 08:26 | — | **연속 실패 30건** | 2.0× |
| 08:32 | — | **연속 실패 30건** | **4.0×** |
| 12:05 | 18b | p90 1.99s (기준 0.98s) | 2.0× |

**하루에 네 번 트립했고 지연이 4배까지 올라갔다.** 즉 재수집은 "요청 수 ÷ 속도"가 아니라 **소스가 부하에 반응해 우리를 늦추는 적대적 과정**이다. 워커를 늘려도 가드가 지연을 늘려 상쇄한다(§10-3의 근거이기도 하다).

### 7-3. 그리고 **이전 대상이 움직이고 있다**

`docs/SOURCE-FIELDS.md` §8 실측(2026-08-28):

| 코드 | 시도 | 소스 총량 | 레이크 보유 | 보유율 |
|---|---|---|---|---|
| 3·4·6·7·9·10·11·12·14·16 | 대구·인천·대전·울산·강원·충북·충남·전북·경북·제주 | — | — | **7~9%** |
| 8 | 경기 | 54,132 | 57,538 | 100%+ |
| **18** | **전남광주** | **58,459~60,198** | **1,600** | **3%** |

**대부분의 시도가 8%대다.** 백필이 끝나려면 지금 도는 3개(40시간)보다 훨씬 많이 남았다. 그리고 지금 이 순간에도 `r18a`·`r18b`·`backfill-history`가 `data/`에 쓰고 있다.

**그래서 이전은 "정지된 스냅샷 복사"가 아니라 "움직이는 대상 복사"다.** 이게 이 절이 어려운 진짜 이유다 — rsync 한 번 돌리고 "다 왔다"고 할 수 없다.

> ⚠ **리더의 "92.9%"와 이 표가 안 맞는다.** 이 표는 대부분 8%대라고 말한다. 92.9%가 다른 축(필드 커버리지? 특정 기간?)의 수치라면 둘 다 참일 수 있다. **어느 쪽이든 이전 판단은 안 바뀐다** — 디스크에 있는 것이 다시 얻기 비싸다는 사실이 근거이지, 그게 전체의 몇 %인지가 근거가 아니다. 다만 **백필 잔량 추정에는 이 표를 써야 한다.**

### 7-4. 움직이는 것을 옮기는 법 — **레이크 자체가 답을 준다**

C5가 다른 목적으로 발견한 성질이 여기서 그대로 쓰인다:

> *"레이크는 append-only이고 파일명이 `part-{time_ns:020d}-…`라 **파일명 상한 한 줄로 스냅샷이 공짜로 나온다.** 백필을 세울 필요가 없다."*

**raw와 parquet은 append-only + 고유 파일명이다.** 따라서:
- **이미 복사한 파일은 절대 안 바뀐다** → 증분 복사가 안전하다
- **워커를 세우지 않고 대부분을 미리 옮길 수 있다**
- `config.py:49`가 확인해준다 — *"raw/parquet 은 파일명이 고유해 공유해도 충돌하지 않는다(검증됨)"*

**정지가 필요한 건 `state*.sqlite` 넷뿐이다.** sqlite는 append-only가 아니고, 쓰는 중에 복사하면 깨진 파일을 얻는다.

**그래서 절차가 세 단계로 갈린다:**

| # | 단계 | 워커 | 시간 |
|---|---|---|---|
| 1 | raw + parquet 벌크 업로드 | **도는 채로** | 길다 (2.7GB) |
| 2 | 워커 정지 → 델타(신규 파일) + `state*.sqlite` 업로드 | **정지** | **짧다 — 이게 다운타임 전부** |
| 3 | 워커 재개 (또는 새 기계에서 재개) | 재개 | — |

**다운타임이 2단계 하나로 줄어든다.** 이게 append-only 성질의 값이다.

### 7-5. 어디에 두나 — **Cloudflare R2**

GitHub에 안 들어간다(2.7GB, 219,487 파일). 스택 안에서 답은 하나다:

| 후보 | 판정 |
|---|---|
| 외장 디스크 | ❌ 백업은 되지만 **이전에 사람이 들고 가야 한다.** 그리고 두 기계 사이 동기화가 수동 |
| GitHub LFS / Release | ❌ 크기·파일 수 부적합 |
| **Cloudflare R2** | ✅ **스택 안. egress 무료. 10GB 무료 티어에 2.7GB가 들어간다** |

**R2가 백업과 이전을 동시에 푼다** — 새 기계는 R2에서 당기면 되고, 사람이 디스크를 들고 갈 필요가 없다.

**⚠ 219,487개를 개별 업로드하지 마라.** 파일 하나당 Class A 작업 하나다(무료 1M/월이라 들어가긴 한다). 하지만 작은 파일 22만 개는 rclone으로도 느리고, 무엇보다 **"다 왔나"를 검증하기 어렵다.**

**tar 단일 객체로 올린다:**
```bash
# 스냅샷 — 워커 정지 시점
tar -cf - data/ | zstd -3 -o lake-YYYYMMDD.tar.zst
sha256sum lake-YYYYMMDD.tar.zst > lake-YYYYMMDD.sha256
rclone copy lake-YYYYMMDD.tar.zst r2:eatbid-lake/
```
객체 2개, 검증 1줄, 복원 1줄. **raw가 append-only라 스냅샷 사이에 잃는 건 "마지막 스냅샷 이후분"뿐이고 그건 재수집 가능한 최근분이다.**

### 7-6. 뜬 스냅샷 — 2026-08-28 ✅ **실행 완료**

**복원 절차까지가 백업이다.** 안 도는 테스트가 없는 것보다 나쁜 것과 같은 이유로, **복원해 본 적 없는 백업은 없는 백업보다 나쁘다** — 있다고 믿게 만든다. 그래서 아래를 리포에 둔다. `H:` 에도 같은 내용의 `README.md` 를 뒀지만 **그건 그 디스크와 함께 사라진다. 정본은 여기다.**

```
원본  F:\Project\eat-bid\data          Disk 3  CT1000P5PSSD8 (NVMe)
사본  H:\backup\eatbid\20260828        Disk 1  WDC WD10EZEX (SATA HDD)
```

**물리적으로 다른 디스크다**(`Get-Partition` 으로 확인). 같은 디스크의 다른 파티션이면 디스크가 죽을 때 같이 죽으니 백업이 아니다.

#### ① 무엇을 담았나

| 경로 | 파일 | 내용 |
|---|---|---|
| `data/raw/` | **223,084** | 원본 XML(gz). **이게 자산의 전부다** |
| `data/parquet/` | 3,837 | 레이크 |
| `data/parquet_v2/` | 5,064 | 레이크 v2 |
| `data/bidboard/` | 3 | 산출물 json |
| `data/reference/` | 2 | |
| `data/` 루트 | 4 | `crawl-guard.json`·`source-drift.json` 등 |
| **`state/`** | **4** | 상태 sqlite — **별도 방식**(아래 ②) |

robocopy 보고: Dirs 581/581 · Files **231,994 복사 / FAILED 0** · Bytes **2.192 GB**(Skipped 12.39 MB = 일부러 뺀 sqlite 4개).

> ⚠ `du -sh data/` 는 **2.7GB** 라고 말한다. 실제 바이트는 2.19GB다. 22만 개 작은 파일의 블록 할당 오버헤드다 — **크기로 대조하지 마라. 파일 개수로 대조하라.**

**시각이 둘이다. 이게 ④에서 중요하다:**
- `state/` 스냅샷 — **21:44:30**
- `data/` 벌크 종료 — **21:47:07**

#### ② 어떻게 떴나 — 워커를 멈추지 않았다

스냅샷 시점에 백필 3개(`r18a`·`r18b`·`backfill-history`)가 원본에 쓰고 있었다. 그래서 두 갈래로 갈랐다:

| 대상 | 방법 | 왜 |
|---|---|---|
| `data/` | robocopy (`/XF *.sqlite`) | `raw`·`parquet` 은 append-only + 고유 파일명이라 **이미 복사한 파일은 안 바뀐다.** 도는 채로 복사해도 각 파일이 온전하다 |
| `state*.sqlite` | **sqlite 백업 API** (`conn.backup()`) | sqlite 는 append-only 가 아니다. **쓰는 중에 파일을 복사하면 찢어진 사본이 나오고 그건 조용하다** — 파일은 생기고, 열어봐야 깨진 걸 안다 |

#### ③ 복원

```bash
# 1. 레이크
robocopy H:\backup\eatbid\20260828\data F:\Project\eat-bid\data /E

# 2. 상태 — data/ 루트에 그대로 놓는다 (config.py 의 Paths.state_db 가 여기를 본다)
copy H:\backup\eatbid\20260828\state\*.sqlite F:\Project\eat-bid\data\
```

Postgres·parquet 은 복원 대상이 아니다 — raw 에서 다시 만들어진다(§7-1).

#### ④ 검증 — 파일 개수만으로는 부족하다

**raw 는 개수로 충분하지만 sqlite 는 열어봐야 한다.** `conn.backup()` 이 성공해도 사본이 온전한지는 별개다.

```bash
# raw — "복사 명령이 성공했다"와 "다 왔다"는 다르다
find data/raw -type f | wc -l                    # >= 223,084

# sqlite — 넷 다 열리고, 껍데기가 아닌지 확인한다
python - <<'PY'
import sqlite3, glob, os
for f in sorted(glob.glob("F:/Project/eat-bid/data/state*.sqlite")):
    c = sqlite3.connect(f)
    print(os.path.basename(f),
          c.execute("pragma integrity_check").fetchone()[0],
          c.execute("select count(*) from done").fetchone()[0])
PY
```

**2026-08-28 실측(사본을 실제로 열어 확인함):**

| 파일 | integrity | 사본 done | 그때 원본 | 차 |
|---|---|---|---|---|
| `state.sqlite` | ok | 184,189 | 184,989 | +800 |
| `state-18a.sqlite` | ok | 11,353 | 11,953 | +600 |
| `state-18b.sqlite` | ok | 17,504 | 18,104 | +600 |
| `state-18c.sqlite` | ok | 9,557 | 9,557 | **+0** |
| **합계** | | **222,603** | 224,603 | +2,000 |

**판정선: 사본 ≤ 원본이어야 정상.** 사본이 더 크면 그게 사고다(엉뚱한 파일을 떴다는 뜻).
그리고 **`18c` 의 차가 정확히 0인 것이 그 워커가 죽은 게 아니라 끝났다는 독립 증거다** — 죽은 워커는 다른 둘이 나아가는 동안 0에 머물지 않는다. 컨테이너도 `Exited (0)` 이다.

**파일 개수 대조가 스탬프 대조의 데이터판이다** — C7이 이미지에 대해 한 것을 아카이브에 대해 한다.

#### ⑤ ⚠ 이 스냅샷이 **못 담는 것** — 복원하는 사람은 "다 있다"고 믿는다

**a. 스냅샷 이후는 없다.** 복원하면 2026-08-28 21:47 로 돌아간다. 그 뒤 백필이 받은 건 전부 없다.

**b. `data/` 는 단일 시점이 아니다.** 복사하는 동안 워커가 계속 써서 **여러 시점이 섞인 집합**이다. append-only 라 각 파일은 온전하고 빠진 건 최근분뿐이라 문제가 안 된다.

**c. `state/`(21:44:30)가 `data/`(21:47:07)보다 오래됐다.** 즉 **raw 에는 있는데 state 는 "안 받았다"고 아는 공고가 있다.** 방향이 이쪽인 게 중요하다 — 반대였다면 안 받은 걸 받았다고 착각해 **영구 누락**이 됐다. **state 는 실제보다 적게 아는 쪽으로만 틀린다.**

**d. 그래서 백필은 재개로 따라잡는다 — 코드로 확인했다:**

| 층 | 재수집하면 | 근거 |
|---|---|---|
| raw | **제자리 덮어쓰기. 중복 없음** | `archive.py: archive_path()` 가 `raw_dir/{source}/{shard}/{bid_no}.xml.gz` — bid_no 로 결정되는 고정 경로다 |
| parquet | 중복 행이 append 되지만 **조회에서 최신 하나만 보인다** | `lake.py:130` 뷰가 `row_number() over (partition by <key> order by filename desc)` 로 dedup. 파일명이 `part-{time_ns:020d}-…` 라 **filename desc = 최신 우선** |
| state | 되돌아간 만큼 다시 받는다 | 위 둘이 멱등이라 안전하다 |

**→ 복원 후 할 일은 없다. 워커를 다시 띄우면 간격을 알아서 메운다.** 비용은 그 간격만큼의 재수집이다.

**e. 그런데 그 간격은 시간이 갈수록 커진다.** 이 스냅샷의 값은 **날마다 떨어진다.** 몇 달 뒤 복원하면 간격이 곧 그동안의 전부이고, 그건 §7-2 의 적대적 재수집이다. **그래서 1회 스냅샷으로 끝나면 안 된다** — 아래.

### 7-7. 남은 것

- **오프사이트가 없다.** 이 집에 불이 나면 F:·H: 둘 다 없다 → §7-5 의 R2. 아직 안 했다
- **정기화가 없다.** ⑤-e 때문에 1회 스냅샷은 감가한다. R2 로 갈 때 월 1회 tar 스냅샷으로 세운다
- **복원을 실제로 해본 적은 없다.** 위 절차는 **읽어서 옳지 실행으로 검증된 게 아니다.** §9 의 새 기계 완주가 그 검증이다 — 거기서 이 절차가 부트스트랩 6단계가 된다

### 비용

R2 버킷 + rclone 설정 **1시간** · 첫 스냅샷 **1시간** · 이전 절차 스크립트화 **반나절** · 월 스토리지 **₩0**(무료 티어).

### 안 하면 무엇이 깨지나

- **이전 중 사고가 나면 219,487 파일이 사라진다.** 7-2가 보여주듯 재수집은 적대적이고, 지난 공고는 다시 안 열린다
- 이전을 "정지된 대상"으로 다루면 워커를 며칠 세우거나, 안 세우고 **깨진 sqlite를 옮긴다**

---

## §8. 백필을 Argo 위로 — **별도 Application, `automated` 끔**

### 선행 조건

**§0-1을 먼저 고친다.** `update_lake.py:20`·`backfill.py:25` → `default_paths()`. **2줄이다.**

안 고치고 Job으로 옮기면 40시간 크롤이 파드 로컬에 쌓였다가 사라지고, `CrawlState`가 안 살아남아 재개도 없다. **지금 백필이 도는 이유가 그 재개인데, 클러스터에서는 성립하지 않는다.** 배포 작업이 아니라 배포의 전제다.

### 결정 — 형태

| 후보 | 판정 |
|---|---|
| CronJob | ❌ 백필은 **일회성**이다. 주기가 없다 |
| Indexed Job (`parallelism: 3`) | ❌ 인덱스→인자 매핑을 이미지 안에 박아야 한다. `backfill.py`는 argv(시도코드·시작일·종료일·지연)를 받는다 |
| **워커별 Job, 별도 Application, 수동 sync** | ✅ |

### 근거 — 왜 별도 Application이고 왜 `automated`를 끄나

**이 절에서 가장 중요한 판단이다.** `infra/k8s/base/`의 Application은 `automated: { prune: true, selfHeal: true }`다. 백필 Job을 거기 넣으면:

| 문제 | 결과 |
|---|---|
| **`spec.template`이 immutable** | 인자를 한 글자 고치면 sync가 `field is immutable`로 **영구 실패**하고 **그 실패가 web·server 배포까지 막는다** ⬅ `initial-load` Job으로 **이미 겪었다**(`app.yaml` 주석에 기록) |
| `selfHeal: true` | 완료된 Job을 지우면 Argo가 **되살린다** → 40시간이 처음부터 |
| `prune: true` | git에서 지우면 **도는 중에 삭제된다** |

**셋 다 이미 겪었거나 겪을 게 확실하다.**

```yaml
# infra/argocd/application-backfill.yaml (신설)
spec:
  source: { path: infra/k8s/backfill }
  syncPolicy: {}          # automated 없음 — 사람이 sync 한다
```

**분리의 값: 백필 Job의 실패나 immutable 충돌이 서비스 배포를 막지 못한다.** `initial-load` 사고의 재발을 구조로 막는다.

### 결정 — 워커 3개를 어떻게 표현하나

**Job 이름에 인자를 넣는다.** 그러면 immutable이 문제가 안 된다 — 인자가 바뀌면 **다른 이름의 새 Job**이고 옛 Job은 완료 상태로 남는다.

```
infra/k8s/backfill/
  backfill-r18-a.yaml   args ["18", …]  ENV EATBID_STATE_SUFFIX=18a
  backfill-r18-b.yaml   args ["18", …]  ENV EATBID_STATE_SUFFIX=18b
  backfill-history.yaml (전 시도 과거분) ENV EATBID_STATE_SUFFIX=hist
```
`backoffLimit: 0`(재시도는 재시작이 아니라 재개로 한다) · `restartPolicy: Never` · `ttlSecondsAfterFinished` **미설정**(완료 기록을 남긴다).

> ⚠ **실측 불일치.** 도는 컨테이너는 셋(`r18a`·`r18b`·`backfill-history`)인데 상태 파일은 **넷**이다 — `state.sqlite`(10MB) · `state-18a`(656K) · `state-18b`(1.1M) · `state-18c`(608K). 그리고 **`state-18c`는 19:32 이후 안 변했는데 18a·18b는 21:24에 살아 있다.** 18c 워커가 끝난 건지 죽은 건지는 이 문서가 판정할 게 아니다 — **이관 전에 확인하라.** 죽은 거라면 이관이 그걸 조용히 흡수한다.

### 결정 — SQLite 상태파일이 어디 사나

**`/lake`와 같은 볼륨, 루트 바로 아래, 워커별 파일.** 근거는 코드가 이미 갖고 있다(`config.py:49`):

> *"병렬 수집 시 워커마다 다른 상태 파일을 쓰게 한다 — sqlite 는 단일 파일 동시 쓰기에서 잠금 경합이 나고, mark_done 실패는 수집 중단으로 이어진다. **raw/parquet 은 파일명이 고유해 공유해도 충돌하지 않는다(검증됨).**"*

**볼륨은 셋이 공유하고 상태 파일만 `EATBID_STATE_SUFFIX`로 가른다.** 이미 설계돼 있고 이미 그렇게 돌고 있다(`state-18a/b/c`가 증거). **이관에서 바꿀 게 없다** — `EATBID_DATA_ROOT`만 제대로 먹이면 된다.

**⚠ hostPath가 아니라 PVC여야 한다.**

| | hostPath `/lake` | PVC (k3s local-path) |
|---|---|---|
| 백업 대상 | k3d 노드 컨테이너 안 — **경로가 리포에 없다**(§0-2) | `/var/lib/rancher/k3s/storage/<pvc>` 한 곳 |
| 여러 Job 동시 마운트 | 됨 | 됨 (`ReadWriteOnce` = 단일 **노드**. 단일 노드 클러스터라 무관) |
| §7 스냅샷 | 경로를 먼저 알아내야 한다 | 한 곳 |

**단 이 전환은 §11에서 마지막에 둔다** — 2.7GB를 옮기는 동안 백필 3개가 같은 디렉터리에 쓰고 있다. **백필이 끝난 뒤에 한다.**

### 비용

§0-1 수정 **10분**(2줄, 가장 값싼 고수익 항목) · Job 매니페스트 3개 + Application **2시간** · hostPath→PVC + 2.7GB 이전 **반나절**(백필 종료 후).

---

## §9. 부트스트랩 — **이게 결론이다**

§1의 표를 참으로 만드는 절차. **새 Windows PC에서 명령 몇 개로 서는가에 대한 답.**

### 커밋할 파일 둘

**① `infra/k3d.yaml`**
```yaml
apiVersion: k3d.io/v1alpha5
kind: Simple
metadata: { name: eatbid }
image: rancher/k3s:v1.35.5-k3s1        # 실측. 고정한다
servers: 1
ports:
  - { port: "8081:80", nodeFilters: [loadbalancer] }
volumes:
  - { volume: "${EATBID_LAKE_HOST}:/lake", nodeFilters: ["server:0"] }
registries:
  configs: { "ghcr.io": { auth: { username: "...", password: "${GHCR_PAT}" } } }
```

**⚠ 값을 지어내지 마라.** 위 `8081`은 `app.yaml`에서 역산했고 `/lake` 호스트 경로는 **추정**이다(§0-1). 지어내면 이 문서가 C2 위반(*"문서·주석에 값을 복사해 적지 마라"*)을 저지른다. **채우기 전에 한 줄로 확인한다:**
```bash
docker inspect k3d-eatbid-server-0 --format '{{json .Mounts}}{{json .HostConfig.PortBindings}}'
```

**② `infra/bootstrap.sh`** — 7단계, 각 단계마다 검증

| # | 단계 | 검증 (조용히 넘어가지 않는다) |
|---|---|---|
| 0 | `.env.bootstrap` 존재·키 전부 확인 | **없으면 여기서 멈춘다.** 5단계에서 실패하면 클러스터만 반쯤 선다 |
| 1 | `k3d cluster create --config infra/k3d.yaml` | `kubectl get nodes` Ready |
| 2 | ArgoCD 설치 — **버전 고정 URL** | `rollout status deploy/argocd-server -n argocd` |
| 3 | Secret 4개 주입 (§6) | 존재 + **키 이름까지** 대조 |
| 4 | `kubectl apply -f infra/argocd/application.yaml` | `argocd app wait eatbid --health` |
| 5 | ArgoCD가 나머지를 세운다 | **파드 셋의 `BUILD_SHA` = `git rev-parse --short HEAD`** |
| 6 | 데이터 복원 — R2에서 pull (§7) | `find data/raw -type f \| wc -l` |
| 7 | `git config core.hooksPath .githooks` | 훅이 실제로 도는지 1회 확인 |

**규율 (F1):**
- `set -euo pipefail` — 예외 없다
- **`|| true` 금지.** 이 리포에서 `|| true`는 테이블을 전량 날린 전적이 있다
- 재실행 가능하되 **건너뛸 때 "건너뛴다"고 말한다** (조용한 스킵 금지)

> **⚠ `stable` 태그를 쓰지 마라.** ArgoCD `install.yaml`을 `stable`에서 받으면 6개월 뒤 새 기계의 버전이 달라진다 — **재현성이 그 자리에서 깨진다.** 고정 태그를 상수로 박고 올릴 때 커밋한다. `image: rancher/k3s:v1.35.5-k3s1`도 같은 이유로 고정했다.

### 비용

`k3d.yaml` (실측 포함) **1시간** · `bootstrap.sh` **반나절** · **새 기계에서 실제로 완주 반나절** ⬅ 생략하면 이 절이 무의미하다

**마지막 줄이 핵심이다.** 안 돌려본 부트스트랩은 안 돌려본 테스트와 같다 — *"있다고 믿게 만든다"*(`.githooks/pre-push` 주석).

---

## §10. 접은 것들 — 다음 사람이 다시 안 묻게

### 10-1. VMware / 가상화 — **판정: 우리 관심사가 아니다**

k3d는 Docker 위에 서고, Docker는 베어메탈 Windows든 VMware Windows VM이든 같은 추상을 준다. **§1의 성립 조건 아홉 줄 중 어느 것도 호스트가 물리인지 가상인지에 의존하지 않는다.** 그러니 이 결정은 이식성에 영향이 없고, 리더가 편한 쪽을 고르면 된다.

**단 조건이 하나 있다: 여기서 되는 게 거기서도 되려면 §1의 아홉 줄이 참이어야 한다.** VMware를 쓰든 안 쓰든 그건 안 변한다. **가상화는 이 문제를 만들지도 풀지도 않는다.**

(파일 I/O — 219,487개 작은 파일 — 는 가상 디스크에서 느려질 수 있지만, §7이 tar 단일 객체로 다루므로 이전 경로에서는 22만 번이 아니라 한 번이다.)

### 10-2. 인스턴스 둘 동시 운영 — **판정: 값이 없다. 하지 마라**

ArgoCD가 다중 클러스터를 지원하는 건 맞지만, **우리 매니페스트를 두 곳에 그대로 띄우면 데이터가 깨진다:**

| 충돌 | 결과 |
|---|---|
| CronJob 4개가 양쪽에서 돈다 | **eaT에 가는 요청이 두 배.** §7-2가 보여주듯 소스가 이미 저항하고 있다 — 가드가 양쪽에서 트립한다 |
| `load_postgres.py`가 양쪽에서 돈다 | 그 스크립트는 **delete로 시작한다.** 서로를 지운다 |
| 레이크가 둘 | raw가 분열하고, 합칠 때 append-only 가정이 흔들린다 |

**하려면 필요한 것:** 역할별 kustomize overlay(수집/서빙 분리) + 매니페스트가 역할을 강제하는 장치 + 터널·호스트명 이중화. **1인 프로젝트에서 그 복잡도는 값하지 않는다.**

(데이터 축의 충돌은 `data-architect`의 몫이다. 여기서는 "배포가 그걸 표현할 수 있는가"만 답했다 — 답은 "표현할 수는 있지만 표현할 이유가 없다"다.)

### 10-3. "공짜 컴퓨팅" — **워커만 늘리려면 `docker run`이다. ArgoCD 아니다**

리더가 원한 건 여분 기계를 놀리지 않는 것이다. 풀스택 이중화 말고 **백필 워커만** 더 돌리는 형태라면:

**결정: 두 번째 기계에는 k3d도 ArgoCD도 세우지 않는다. `docker run` 하나다.**

근거:
- **워커는 클러스터가 필요 없다.** Postgres도 Ingress도 Secret도 안 쓴다 — `EATBID_DATA_ROOT`와 argv뿐이다
- **이미 그렇게 돌고 있다.** 지금 호스트의 `r18a`·`r18b`·`backfill-history`가 `docker run`이다. 형태를 안 바꾸는 게 가장 싸다
- k3d + ArgoCD + Secret + 부트스트랩을 세워서 얻는 게 컨테이너 하나면 **비용이 값보다 크다**
- 이미지는 §3 덕에 GHCR에 있다 → 두 번째 기계는 `docker run ghcr.io/lamyzm/eatbid-dataplane:$SHA` 한 줄이다. **이게 레지스트리의 부수 이득이다**

**⚠ 그런데 이득 자체가 의심스럽다.** §7-2가 보여주듯 병목은 컴퓨팅이 아니라 **소스 레이트리밋**이다 — 하루에 네 번 트립했고 지연이 4배까지 갔다. **워커를 늘리면 가드가 지연을 늘려 상쇄한다. 선형이 아니다.** 그리고 두 기계가 쓴 raw/parquet을 나중에 합쳐야 한다(append-only + 고유 파일명이라 rsync로 되긴 하지만, 그건 "가벼운 느낌"이 아니다).

**판정: 하려면 `docker run`, 하지만 먼저 워커 추가가 실제로 처리량을 늘리는지 재라.** 그 측정은 `data-architect` 축이다.

---

## §11. 실행 순서

의존 관계가 순서를 정한다.

| # | 작업 | 절 | 비용 | 왜 여기인가 |
|---|---|---|---|---|
| **0** | 🔴 **raw 스냅샷** | §7-7 | 1h | 뒤의 무엇이 실패해도 되돌릴 수 있게. **오늘** |
| **1** | `update_lake.py`·`backfill.py` 경로 버그 | §0-1 | 10m | 2줄. 지금 매일 데이터를 버리고 있다 |
| **2** | `optional: true` 제거 · 훅 정리·커밋 | §6 §4 | 1h | 규칙 적용. 뒤와 독립 |
| **3** | `k3d.yaml` 실측 + 커밋 | §9 | 1h | 이식의 전제. 이게 없으면 새 기계에 클러스터가 안 선다 |
| **4** | 리포 합병 | §2 | 2h | §5(CI 하나)·§8(경로 하나)의 전제 |
| **5** | GHCR + 불변 태그 + 매니페스트 | §3 | 1h | §6의 전제 |
| **6** | CI 워크플로우 | §4 | 4h | §5의 태그 갱신을 실행할 주체 |
| **7** | R2 + 이전 스크립트 | §7 | 4h | 성립 조건 #7·#8 |
| **8** | Cloudflare named tunnel + Access | §5 | 2h | 독립. 사장이 필요해지면 당겨도 된다 |
| **9** | `bootstrap.sh` + **새 기계에서 완주** | §9 | 1d | 여기서 처음으로 3~8이 검증된다 |
| **10** | 백필 Application (백필 종료 후) | §8 | 4h | 40시간 남았다. 그 전엔 건드리지 마라 |

**0·1·2·3은 오늘 해도 된다** — 서로 독립이고 되돌리기 쉽다.
**4가 갈림길이다** — 그 뒤는 전부 단일 리포를 전제한다.
**9가 유일한 진짜 검증이다** — 그 전까지는 전부 "될 것 같다"이다.

---

## §12. 이 축으로 확인 못 한 것

*(rules/README ⑥ — "전수 감사 완료"라고 쓰지 마라. "이 축에 대해 전수"라고 써라.)*

**이 문서의 축은 "코드·이미지·데이터가 기계에서 기계로 어떻게 가는가"다.** 그 축 밖이라 안 본 것:

- **`/lake` hostPath의 실제 호스트 경로.** 크기 일치(2.7GB)로 추정만 했다 → §9의 `docker inspect` 한 줄
- **`state-18c`가 끝난 건지 죽은 건지.** 19:32 이후 정지, 나머지 둘은 21:24 활성 → §8 이관 전
- **리더의 "92.9%"와 `SOURCE-FIELDS.md` §8의 8%대가 안 맞는다.** 축이 다른 두 수치일 수 있다. **이전 판단은 안 바뀌지만 백필 잔량 추정은 이걸 확정해야 한다**
- **`firm_bids` 913만 행 재적재가 실제로 몇 분인가.** `app.yaml` 주석의 "16분"이 현재 행 수 기준인지 불명 → 부트스트랩 6단계 소요 추정에 필요
- **롤백 절차.** 불변 태그가 롤백을 *가능하게* 만들지만(옛 SHA로 되돌리는 커밋) 절차를 안 썼다. **DB 스키마가 앞으로 간 뒤의 롤백은 별개 문제다**
- **`db-migrate`(PreSync)가 백필 Application에도 필요한가.** 별도 Application에는 그 훅이 없다
- **관측.** 백필이 Job이 되면 40시간짜리 진행을 어디서 보나. 지금은 `docker logs`다
- **Cloudflare Access와 Better Auth의 실제 UX.** 두 번 로그인이 사장에게 얼마나 부담인지 안 재봤다 → §5의 "끄는 조건"이 그 측정에 달렸다
