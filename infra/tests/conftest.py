from __future__ import annotations

import sys
from pathlib import Path

# `uv run --project apps/dataplane pytest infra/tests` executes pytest from the
# dataplane environment, whose console-script path does not automatically include
# the monorepo root on Windows. Keep local infrastructure modules importable in the
# exact command used by CI.
MONOREPO_ROOT = Path(__file__).parents[2]
if str(MONOREPO_ROOT) not in sys.path:
    sys.path.insert(0, str(MONOREPO_ROOT))
