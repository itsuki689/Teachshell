#!/usr/bin/env python3
"""Compare generated teaching cases with the unchanged production Swift core."""
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
if len(sys.argv) != 2:
    raise SystemExit("Pass the generated teaching test-bundle JSON path.")
bundle = Path(sys.argv[1]).resolve(strict=True)
sources = sorted((ROOT / "Sources/TeachshelfCore").rglob("*.swift"))
with tempfile.TemporaryDirectory(prefix="teachshelf-teaching-check-") as scratch:
    executable = Path(scratch) / "verify-teaching"
    subprocess.run([
        "swiftc", "-swift-version", "5", "-parse-as-library", "-whole-module-optimization", "-Onone",
        "-module-cache-path", str(Path(scratch) / "ModuleCache"),
        *map(str, sources), str(ROOT / "desktop/scripts/VerifyTeachingRoundtrip.swift"), "-o", str(executable),
    ], check=True, cwd=ROOT)
    subprocess.run([str(executable), str(bundle)], check=True, cwd=ROOT)
