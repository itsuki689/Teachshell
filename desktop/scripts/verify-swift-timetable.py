#!/usr/bin/env python3
"""Validate an explicitly generated TS test bundle with the unchanged Swift core.

Usage:
  TEACHSHELF_TIMETABLE_ROUNDTRIP=/tmp/timetable.json npm test
  python3 scripts/verify-swift-timetable.py /tmp/timetable.json
"""
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
if len(sys.argv) != 2:
    raise SystemExit("Pass the generated timetable test-bundle JSON path.")
bundle = Path(sys.argv[1]).resolve(strict=True)
sources = sorted((ROOT / "Sources/TeachshelfCore").rglob("*.swift"))
with tempfile.TemporaryDirectory(prefix="teachshelf-timetable-check-") as scratch:
    executable = Path(scratch) / "verify-timetable"
    subprocess.run([
        "swiftc", "-swift-version", "5", "-parse-as-library",
        "-whole-module-optimization", "-Onone",
        "-module-cache-path", str(Path(scratch) / "ModuleCache"),
        *map(str, sources), str(ROOT / "desktop/scripts/VerifyTimetableRoundtrip.swift"),
        "-o", str(executable),
    ], check=True, cwd=ROOT)
    subprocess.run([str(executable), str(bundle)], check=True, cwd=ROOT)
