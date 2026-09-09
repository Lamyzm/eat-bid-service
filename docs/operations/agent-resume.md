---
status: active
last_reviewed: 2026-09-10
review_trigger: agent-handoff-or-resume-change
---

# 대화 없이 현재 작업 이어받기

이 문서는 Codex 또는 Claude 세션이 종료돼도 저장소에서 작업을 다시 찾기 위한 실행 진입점이다.
현재 인계 자료는 [2026-09-09 최소 MVP 인계](handoffs/2026-09-09-mvp.md)다.
그 자료는 관측 시점의 복구 색인이며 최신 상태·담당·승인 범위는 Linear, 실제 구현과 claim·세션 잠금은
Git과 `workflow:doctor`로 재확인한다. 인계 파일 날짜가 최신 상태라는 보장은 없다.

사용자는 저장소 루트에서 새 Claude를 열고 아래 한 문장만 전달하면 된다.

> AGENTS.md와 docs/operations/agent-resume.md부터 읽고 현재 MVP를 이어받아. 실행 중인 writer와 claim을 먼저 확인하고, 이전 대화 없이 Git·Linear의 실제 상태에서 다음 미완료 단계부터 진행해.

## 총괄 역할도 함께 승계한다

사용자가 "이어받아"라고 지정한 새 Claude/Codex는 이전 총괄의 **역할**을 승계한다.
인계에 나오는 `root`·`총괄`·`인수 담당`은 특정한 살아 있는 Codex 세션을 뜻하지 않는다.
받은 세션이 이미 승인된 MVP 범위 안에서 diff 검토, 필요한 검증, claim 이전, 격리 통합,
다음 구현 또는 위임을 결정한다. 이전 세션의 별도 허가를 기다리지 않는다.
새 제품 의미·배포·운영 데이터 변경까지 승인 범위를 넓히는 권한은 아니다.

기존 writer가 살아 있으면 그 구현이 끝날 때까지 해당 쓰기는 기다리는 것이 정상이다.
그동안 후속 계약·시안·인수 조건을 읽기 검토하고, 종료 후 실제 결과로 다음 단계를 판정한다.
빈 시간을 채우려고 새 work item이나 중복 구현을 만들 필요는 없다. 즉시 강제 교대를 요청받은
경우에도 writer와 시험 자원의 종료·변경 보존이 먼저이며, 생존 확인 없이 세션 잠금을 넘겨받지 않는다.

## 처음 할 일

1. `AGENTS.md`의 필수 원문, 이 문서의 현재 인계 링크, 해당 Linear issue의 최신 handoff를 읽는다.
2. `git worktree list`, 대상 worktree의 `git status --short`, `git log -5 --oneline`,
   `node tools/agent-workflow/cli.mjs doctor`로 실제 경로·HEAD·dirty·claim·holder를 확인한다.
   다른 worktree를 root 명령에서 조사할 때는 `git -C <절대경로>` 또는 lifecycle의 `--worktree`를 쓴다.
3. 이전 writer와 그 자식 시험 프로세스가 살아 있는지 확인한다. PID는 재사용될 수 있으므로
   인계의 세션 ID·실행 파일·생성 시각·부모 관계와 함께 대조한다. 명령줄이나 환경 전체를 출력하지 않는다.
4. 살아 있으면 같은 소스를 수정하거나 같은 Claude 세션을 resume하지 않는다. 그 작업은 읽기 검토만
   하고 독립적인 다음 준비를 한다. doctor의 `holder.live`는 pid 또는 heartbeat 판정이며 인계 대조를
   대신하지 않는다.
5. 실행자가 끝났다면 결과·diff·시험의 최종 종료 코드를 읽는다. 부모만 끝나고 시험 자식이 남았다면
   자식의 종료와 정리까지 기다린다. 실행 중인 dev·백필 프로세스를 일괄 종료하지 않는다.
6. 받을 세션이 그 worktree에서 `pnpm workflow:claim -- EAT-번호` 후 `pnpm workflow:doctor:infisical`로
   검증한다. claim은 이전 claim을 대체하므로 release가 선행 조건은 아니다. 이전 세션이 살아 있으면
   세션 잠금이 쓰기를 막으므로 먼저 그 세션을 닫고, 끝난 것이 확실할 때만 `pnpm workflow:session take`를
   쓴다. 같은 issue의 이전 writer가 살아 있거나 소유권을 확인할 수 없으면 dependent mutation을 시작하지 않는다.

작업 폴더를 바꿀 때는 새 Claude를 그 폴더에서 시작한다. 이미 writer로 결박된 세션이 `cd`로
다른 worktree의 파일을 수정해 hook을 우회하지 않는다. 문서를 읽는 일에는 새 claim이 필요 없다.

### Windows에서 출력 범위를 좁힌 확인 예시

아래 값은 현재 handoff의 관측 값으로 바꾼다. 프로세스 목록은 조회만 하며 종료하지 않는다.

```powershell
$resumeSession = 'handoff에 적힌 Claude 세션 UUID'
$observedWriterPid = 26564
$processSnapshot = Get-CimInstance Win32_Process
$processSnapshot |
  Where-Object { $_.Name -eq 'claude.exe' -and $_.CommandLine -like ('*' + $resumeSession + '*') } |
  Select-Object ProcessId, ParentProcessId, CreationDate
$processSnapshot |
  Where-Object { $_.ParentProcessId -eq $observedWriterPid } |
  Select-Object ProcessId, ParentProcessId, Name, CreationDate
```

자식이 있으면 그 PID를 부모로 같은 조회를 이어 자손 시험까지 확인한다. UUID 인자가 없는
interactive 프로세스는 첫 조회로 종료를 판정할 수 없으므로 실제 실행 로그와 생성 시각을 함께 본다.
PID 일치만으로 다른 프로세스를 그 작업 소유라고 단정하지 않는다.

`node tools/agent-workflow/cli.mjs doctor`는 네트워크 없이 로컬 claim과 세션 잠금을 읽는 명령이다.
`pnpm workflow:doctor:infisical`은 설정된 credential을 자식에 주입하는 온라인 진단 경로이며,
신규 claim은 `pnpm workflow:claim -- EAT-번호`의 원격 검증을 거쳐야 한다.
다른 폴더를 루트에서 읽는 정확한 예는
`pnpm workflow:doctor -- --worktree F:/Project/eat-bid-service/.worktrees/eat-47-account-foundation`이다.

## 미커밋 변경과 Claude 대화

- 갑작스러운 종료는 dirty tree를 남길 수 있다. 현재 diff와 파일을 보존하고, issue의 승인 범위와
  대조한 뒤 새 writer가 이어서 완성한다. 강제 reset·clean·미확인 stash 복원으로 clean을 만들지 않는다.
- 로컬 Claude 대화가 남아 있으면 **기존 writer 종료 확인 후** 같은 worktree에서
  `claude --resume <기록된-session-id>`를 사용할 수 있다. 재개 후에도 doctor/claim을 먼저 확인한다.
- 대화가 없거나 손상됐다면 새 Claude가 현재 인계의 원문·계획·Git diff로 시작한다. 이전 대화 복원은
  구현의 선행조건이 아니다. 사용자에게 같은 기획을 다시 설명해 달라고 요구하지 않는다.
- 실행 한도·강제 종료·테스트 실행 시작은 성공이 아니다. 결과가 남지 않았으면 미검증으로 적고
  필요한 경계만 재실행한다. 이전 통과 뒤 코드가 바뀌었으면 새 조합의 관련 검증을 수행한다.

## 다음 교대에도 유지할 것

단계 시작·인계·검증 완료 시 Linear의 해당 issue에 `branch/worktree | 기준 commit | owned paths |
다음 한 단계 | 검증·미검증 | 금지된 외부 작업`을 남긴다. 구현 세부 계획과 이유는 코드와 같은
worktree에 보존하고 handoff에는 그 원문을 링크한다. 이 파일에는 최신 작업을 찾는 링크만 유지한다.

공통 절차는 [위임 스킬](../../.agents/skills/eatbid-supervised-delivery/SKILL.md), 소유권 명령은
[Linear workflow](linear-agent-workflow.md), 코드 리뷰는 [공통 AI advisory](ai-code-review.md)가 소유한다.
공유 outbox에 오래된 다른 작업이 섞였으면 전체 `workflow:sync` 대신 해당 issue의 scoped handoff만
기록한다. API key·쿠키·세션 토큰·원문 대화/추론 로그를 문서에 복사하지 않는다.

이 절차는 세션이 끝나도 **재개할 수 있게 하는 장치**다. 컴퓨터 종료 후 작업을 자동 시작하는
서비스나, 담당 agent가 없을 때 새 작업을 자동 배정하는 상시 감독기는 이 변경에 포함하지 않는다.
