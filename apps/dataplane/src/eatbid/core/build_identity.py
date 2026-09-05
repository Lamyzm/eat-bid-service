"""모듈 책임: 배포 스탬프 build_sha가 받아들이는 hex 정체성의 단일 권위를 둔다."""

from __future__ import annotations

import re

__all__ = ["BUILD_SHA_MESSAGE", "BUILD_SHA_PATTERN", "validate_build_sha"]

# `docs/ARCH-DELIVERY.md` §3·§5: BUILD_SHA는 "파드 셋이 같은 커밋을 가리키는가"를 묻는 배포
# 스탬프이며 값은 release commit이다. 이미지는 `ENV BUILD_SHA=$GIT_SHA`로 40자 SHA-1을 굽고
# server(`apps/server/src/platform/config/environment.ts`)도 40 또는 64자를 받는다. dataplane만
# SHA-256을 전제하면 같은 커밋을 가리켜야 할 세 이미지 중 하나가 스탬프 대조에서 빠진다.
#
# 왜 한 상수인가. 이 판정은 CLI 인자, discover 요청, run 계획 기록, 발행 projector_version 네 곳에서
# 각각 필요하다. 정규식이 넷으로 흩어지면 한 곳만 넓혀도 나머지가 조용히 막고 그 실패는 릴리스 뒤
# 첫 수집 실행에서야 드러난다. 원본 객체 해시(content sha256)는 의미가 다른 값이므로 64자 계약을
# 그대로 두고 이 값 타입을 공유하지 않는다.
BUILD_SHA_PATTERN = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
BUILD_SHA_MESSAGE = "build_sha must be a lowercase 40 or 64 character hexadecimal identity"


def validate_build_sha(value: str) -> str:
    if not isinstance(value, str) or BUILD_SHA_PATTERN.fullmatch(value) is None:
        raise ValueError(BUILD_SHA_MESSAGE)
    return value
