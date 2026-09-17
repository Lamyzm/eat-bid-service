---
name: search-first
description: 서드파티 library, SDK, API를 대상으로 코드를 쓰기 전에 현재 문서와 기존 코드를 확인할 때 사용한다. library, SDK, API, CLI flag, config 형식, 언어/framework 버전 동작을 다루는 작업이면 항상 해당한다. 특히 기억으로 어떤 동작을 쓸 때, 버전 번호가 걸려 있을 때, API가 "이렇게 동작해야 하는데" 확인 안 된 채로 있을 때 쓴다.
---

# 먼저 검색한다

훈련 데이터에서 온 API 지식은 **낡았다고 가정한다.** library는 시그니처를 바꾸고, flag는 사라지고, 권장 패턴은 뒤집힌다. 기억에서 끌어온 코드는 가장 위험한 종류의 오류다 — 그럴듯해 보이기 때문이다.

## 항상 확인해야 하는 경우

- 외부 library, SDK, API를 호출하는 코드를 쓸 때
- CLI flag, config 파일 형식, 환경 변수 이름을 쓸 때
- 버전 번호에 묶인 동작("3.11부터", "v5에서")
- "이래야 할 텐데"라고 생각했지만 **실제로 확인한 적 없을** 때
- 에러 메시지가 문서와 안 맞을 때 — 대개 문서가 아니라 당신의 기억이 낡은 것이다

## 확인 순서

1. **공식 문서와 release note** — 1차 출처. 블로그와 Stack Overflow는 그 다음이다.
2. **실제로 설치된 버전** — `package.json`, `requirements.txt`, lockfile을 확인한다. 최신 문서라도 실제 사용 버전과 안 맞으면 무용하다.
3. **코드베이스 안의 기존 사용례** — 같은 library를 이미 이 프로젝트에서 쓰고 있다면, 그 패턴이 이 프로젝트의 답이다.
4. **필요하면 실제로 실행한다.** REPL 한 줄이 추측 열 줄보다 싸다.

## 비용 감각

확인 비용이 틀렸을 때의 비용보다 **쌀 때** 확인한다 — 대개는 훨씬 싸다. 반대로 잘 알려진 표준 library의 안정된 API를 매번 다시 확인하는 것은 낭비다.

- library나 버전 선택이 다른 팀·서비스가 물려받는 의존성(공유 build, 공통 base image, 조직 전체 pin)이 될 거라면, "여기서 돌아가는가"만이 아니라 조직이 승인/리뷰한 버전에도 맞는지 확인한다 — 여기서의 나쁜 선택이 모두가 따라 하는 기본값이 된다.
- 검증한 선택이 회사의 기본값(모든 새 서비스가 물려받는 pin, 남들이 따라 할 패턴)이 되려 한다면, 진짜 시험은 5년 뒤 팀이 원래 검증한 사람을 찾지 않고도 그 근거를 믿을 수 있게 문서화됐는지다.
- 조직 전체의 기본값이 되려 한다면 license 조건, vendor lock-in, EOL/지원 일정을 유연성 유지와 저울질한다 — vendor가 폐기하거나 가격을 올릴 수 있는 의존성은 단순한 엔지니어링 선택이 아니라 예산·지속성 위험이다.

찾은 결과가 기억과 다르면 **그 사실을 기록한다** — 안 그러면 다음 사람이 같은 실수를 반복한다.

## 이 저장소에서

Eatbid에서 "기존 사용례를 먼저 본다"의 1차 대상은 `packages/contracts`다. `AGENTS.md` 정언명령 15~17에 따라 canonical interchange와 공개 API 형태의 권위는 거기 있는 Zod schema이며, DB row 표현의 DDL 작성자는 Drizzle 하나뿐이다(정언명령 10) — 새 필드나 endpoint 모양을 기억이나 추측으로 만들지 말고 `packages/db` 스키마와 `packages/contracts`를 먼저 확인한다. 계약이나 의미 값을 바꿨다면 `pnpm architecture:check`, `pnpm contracts:check`, `pnpm contracts:python:check`를 check mode로 돌려 확인이 맞았는지 검증한다. 더 구체적인 계약 변경 절차는 `.agents/skills/eatbid-contract-change`가 권위를 갖는다.
