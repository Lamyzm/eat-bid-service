# -*- coding: utf-8 -*-
"""kustomization.yaml 의 images: 블록을 갱신한다. CI 가 배포 태그를 박는 자리.

    python infra/bump-image.py --sha a1b2c3d eatbid-web eatbid-server
    python infra/bump-image.py --sha a1b2c3d --check       # 바꾸지 않고 현재값만

왜 kustomize 바이너리를 안 쓰나
──────────────────────────────
`kustomize edit set image` 이 정석이지만 GitHub 러너에 기본 설치가 아니다.
설치 스텝을 넣으면 CI 가 외부 릴리스에 매번 의존한다. 하는 일이 YAML 한 블록
갱신이라 리포 안에 두는 게 낫다 — **로컬에서 그대로 돌려볼 수 있다는 게 더 크다.**
CI 에서만 도는 코드는 CI 에서만 깨진다.

왜 태그를 커밋하나 (Image Updater 대신)
──────────────────────────────────────
`:dev` 가변 태그 + imagePullPolicy: IfNotPresent 조합이 "옛 이미지가 도는데
아무도 실패를 보고하지 않는" 사고를 냈다. 불변 태그(:$SHA)면 IfNotPresent 가
**비로소 옳아진다** — 같은 태그는 정의상 같은 내용이다.

그리고 태그가 git 에 있으면 `git log kustomization.yaml` 이 배포 이력이 된다.
지금은 `:dev` 뒤에 뭐가 있는지 git 이 모른다.
설계 근거: docs/ARCH-DELIVERY.md §3.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Windows 콘솔 기본 코드페이지(cp949)에서 한글·em-dash 가 UnicodeEncodeError 로
# 죽는다. CI(리눅스)에서는 안 나고 로컬에서만 나므로 더 늦게 발견된다.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

KUST = Path(__file__).resolve().parent / "k8s" / "base" / "kustomization.yaml"
REGISTRY = "ghcr.io/lamyzm"


def parse(text: str) -> dict[str, tuple[str, str]]:
    """현재 images: 블록에서 {이름: (newName, newTag)} 를 뽑는다."""
    out: dict[str, tuple[str, str]] = {}
    cur = None
    in_block = False
    for line in text.splitlines():
        if re.match(r"^images:\s*$", line):
            in_block = True
            continue
        if in_block:
            if line and not line[0].isspace():
                break
            m = re.match(r"\s*-\s*name:\s*(\S+)", line)
            if m:
                cur = m.group(1)
                out[cur] = ("", "")
            elif cur:
                if m2 := re.match(r"\s*newName:\s*(\S+)", line):
                    out[cur] = (m2.group(1), out[cur][1])
                elif m2 := re.match(r"\s*newTag:\s*(\S+)", line):
                    out[cur] = (out[cur][0], m2.group(1))
    return out


def render(images: dict[str, tuple[str, str]]) -> str:
    lines = ["images:"]
    for name in sorted(images):
        new_name, tag = images[name]
        lines.append(f"  - name: {name}")
        lines.append(f"    newName: {new_name}")
        lines.append(f"    newTag: {tag}")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help="예: eatbid-web eatbid-server")
    ap.add_argument("--sha", help="박을 태그 (보통 짧은 커밋 SHA)")
    ap.add_argument("--check", action="store_true", help="현재 태그만 출력")
    ap.add_argument("--file", type=Path, default=KUST)
    a = ap.parse_args()

    if not a.file.exists():
        print(f"실패: 없다: {a.file}")
        return 1
    text = a.file.read_text(encoding="utf-8")
    images = parse(text)

    if a.check:
        if not images:
            print("images: 블록이 없다 — 아직 로컬 태그를 쓴다")
            return 0
        for n, (nn, t) in sorted(images.items()):
            print(f"  {n:20s} {nn}:{t}")
        return 0

    if not a.sha or not a.names:
        print("실패: --sha 와 이름이 최소 하나 필요하다")
        return 1
    # 태그가 커밋 SHA 인지 최소한 형태로 본다. 빈 값이나 'latest' 가 박히면
    # 불변 태그의 의미가 사라지는데, 그건 조용히 통과한다.
    if not re.fullmatch(r"[0-9a-f]{7,40}", a.sha):
        print(f"실패: --sha 가 커밋 해시 형태가 아니다: {a.sha!r}")
        return 1

    for n in a.names:
        images[n] = (f"{REGISTRY}/{n}", a.sha)

    block = render(images)
    if re.search(r"^images:\s*$", text, re.M):
        # 기존 블록을 통째로 갈아끼운다
        text = re.sub(r"^images:\s*\n(?:[ \t].*\n?)*", block, text, count=1, flags=re.M)
    else:
        text = text.rstrip("\n") + "\n\n" + block
    a.file.write_text(text, encoding="utf-8")

    # 쓴 것을 되읽어 확인한다. "썼다"는 "그렇게 됐다"가 아니다.
    back = parse(a.file.read_text(encoding="utf-8"))
    for n in a.names:
        if back.get(n) != (f"{REGISTRY}/{n}", a.sha):
            print(f"실패: 되읽으니 {n} 이 {back.get(n)} 이다")
            return 1
    print(f"갱신: {', '.join(a.names)} → {a.sha}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
