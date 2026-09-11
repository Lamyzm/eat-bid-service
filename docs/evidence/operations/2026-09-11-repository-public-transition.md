---
id: EVIDENCE-OPERATIONS-REPO-PUBLIC-2026-09-11
status: evidence
canonical_for: none
last_reviewed: 2026-09-11
review_trigger: repository-visibility-change
---

# 저장소를 공개로 바꾸기 전 노출면 실측 (2026-09-11, EAT-191)

관측 시점의 증거다. 공개 전환 자체의 이유는 EAT-191에 있다.

## 1. 왜 지금 보는가

비공개 저장소는 GitHub Actions가 월 2,000분 한도이고 2026-09-11에 그 한도로 CI가 전부 멈췄다.
공개 저장소는 Actions가 무제한이다. 공개는 되돌려도 사본이 남으므로 되돌릴 수 없는 결정으로 다룬다.

## 2. 비밀값 스캔

작업 트리 전체를 private key blob, Slack token, OpenAI key, AWS access key id, GitHub PAT, JWT
패턴으로 훑었다. 걸린 것은 하나다.

| 위치 | 값 | 판정 |
|---|---|---|
| `tools/review/reuse-catalog.test.mjs:112` | `ghp_abcdef…1234567890` | 비밀 탐지기가 잡는지 보는 fixture. 실재하지 않는 토큰 |

커밋 1,206개 이력에서도 같은 패턴으로 실제 비밀값은 나오지 않았다. 운영 자격은 전부 Infisical에 있고
클러스터에는 InfisicalSecret으로 들어간다.

## 3. 가린 값

비밀은 아니지만 운영 호스트를 특정하는 값이라 걷었다.

| 값 | 무엇 | 처리 |
|---|---|---|
| `100.100.253.75` | 운영 PC의 Tailscale IP | `<호스트 Tailscale IP>` |
| `192.168.219.43` | 운영 PC의 LAN IP | `<호스트 LAN IP>` |
| `mw-vmhost` | 운영 PC 호스트명 | `운영 PC` |
| ssh 계정명 | 호스트 ssh 계정 | `ssh 전용 계정` |

절차 문서는 이 값들 없이도 같은 작업을 할 수 있다. 실제 값은 운영자가 Infisical이나 개인 메모에서 읽는다.

## 4. 이력에는 남는다

위 세 값은 각각 커밋 2개에 남아 있고 공개 전환 뒤에도 읽힌다. 이력을 다시 쓰지 않기로 했다.

판단 근거는 도달성이다. `100.100.253.75`는 Tailscale의 CGNAT 대역이라 같은 tailnet에 인증된 기기에서만
닿고, `192.168.219.43`은 사설 대역이라 인터넷에서 의미가 없다. 호스트 방화벽은 6443·2222를 Tailscale과
사설 LAN에만 연다. 즉 이 값들을 아는 것만으로는 아무 데도 닿지 못하고, 이미 tailnet 안에 있는 상대에게는
새로 알려주는 것이 없다.

반대편 비용은 크다. 이력을 다시 쓰면 활성 worktree 20개와 그 branch가 전부 기준을 잃는다. 얻는 것이
없는 쪽에 그 비용을 쓰지 않는다.

전제가 바뀌면 다시 본다: 호스트를 공인 IP로 직접 노출하거나, 6443·2222를 tailnet 밖으로 열면 그때는
주소를 아는 것이 공격면이 된다. 그 변경의 review_trigger가 이 문서다.

## 5. 남기기로 한 값

`infra/platform/argo-workflows.application.yaml`의 R2 endpoint에 Cloudflare 계정 식별자가 있다.
남긴다.

접근을 막는 것은 주소가 아니라 `eatbid-r2` Secret의 access key다. 버킷은 익명 목록이 되지 않는다.
반대로 이 값을 저장소에서 빼면 Argo CD가 git에서 읽을 것이 없어져 실행 로그의 R2 보관(EAT-172)이
깨지거나 수기 패치로 git과 어긋난다. 얻는 것 없이 배포 모델을 무너뜨리는 교환이다(AGENTS 9항).
