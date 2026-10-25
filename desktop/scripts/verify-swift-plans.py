#!/usr/bin/env python3
"""Compile the unchanged production Swift core and compare generated plan cases.

From desktop/:
  TEACHSHELF_PLANS_ROUNDTRIP=/tmp/plans.json node --experimental-strip-types --test tests/plans.test.ts
  python3 scripts/verify-swift-plans.py /tmp/plans.json
"""
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
if len(sys.argv) != 2:
    raise SystemExit("Pass the generated plan test-bundle JSON path.")
bundle = Path(sys.argv[1]).resolve(strict=True)
sources = sorted((ROOT / "Sources/TeachshelfCore").rglob("*.swift"))
with tempfile.TemporaryDirectory(prefix="teachshelf-plans-check-") as scratch:
    executable = Path(scratch) / "verify-plans"
    subprocess.run([
        "swiftc", "-swift-version", "5", "-parse-as-library",
        "-whole-module-optimization", "-Onone",
        "-module-cache-path", str(Path(scratch) / "ModuleCache"),
        *map(str, sources), str(ROOT / "desktop/scripts/VerifyPlansRoundtrip.swift"),
        "-o", str(executable),
    ], check=True, cwd=ROOT)
    subprocess.run([str(executable), str(bundle)], check=True, cwd=ROOT)
