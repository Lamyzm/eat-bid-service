@AGENTS.md

# Claude Code adapter

이 파일은 Claude Code를 저장소의 공통 작업 계약에 연결하는 얇은 adapter다.

- "이어서 진행", "작업 인계", "Codex 종료 후 재개" 요청은 먼저
  [`docs/operations/agent-resume.md`](docs/operations/agent-resume.md)를 읽는다. 다른 실행자가 살아 있는지
  확인하기 전에 같은 세션을 resume하거나 그 worktree의 세션 잠금을 넘겨받지 않는다.

- 제품·아키텍처·데이터 불변식은 `AGENTS.md`와 Accepted ADR만 권위가 있다.
- 문서 권위와 읽기 순서는 `docs/README.md`를 따른다.
- 작업 범위·상태·acceptance는 Linear issue 또는 승인된 변경 계약에서 읽는다.
- Claude auto memory, 대화 기록, 로컬 task list는 개인 실행 보조물이며 프로젝트 사실이나
  완료 상태의 진실 원천이 아니다.
- 다른 Codex/Claude 세션과 병렬 작업할 때는 같은 파일을 공동 편집하지 말고 별도 worktree와
  한 명의 writing agent를 사용한다.
