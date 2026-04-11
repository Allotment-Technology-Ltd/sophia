#!/usr/bin/env python3
"""Reserved for optional repo doc automation.

The public repository tracks only a small curated set under `docs/`. README files
use static tables; there are no generated blocks to refresh. CI runs `--check`
and expects success.
"""

from __future__ import annotations

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Repo documentation block refresh (no-op)")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Verify generated blocks (none configured)")
    mode.add_argument("--write", action="store_true", help="Rewrite generated blocks (none configured)")
    args = parser.parse_args()

    _ = args.write
    print("Generated documentation blocks are up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
