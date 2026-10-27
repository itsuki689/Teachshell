#!/usr/bin/env python3
"""Compare generated TypeScript mutations with the unchanged production Swift core."""
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT = Path(__file__).resolve().parents[2]
if len(sys.argv) != 2:
    raise SystemExit("Pass the generated schedule-interactions JSON bundle path")
bundle = Path(sys.argv[1]).resolve(strict=True)
with tempfile.TemporaryDirectory(prefix="teachshell-interactions-swift-") as scratch:
    executable = Path(scratch) / "verify-interactions"
    sources = sorted((ROOT / "Sources/TeachshelfCore").rglob("*.swift"))
    subprocess.run([
        "swiftc", "-swift-version", "5", "-parse-as-library", "-whole-module-optimization", "-Onone",
        "-module-cache-path", str(Path(scratch) / "ModuleCache"), *map(str, sources),
        str(ROOT / "desktop/scripts/VerifyScheduleInteractions.swift"), "-o", str(executable),
    ], check=True, cwd=ROOT)
    subprocess.run([str(executable), str(bundle)], check=True, cwd=ROOT)
