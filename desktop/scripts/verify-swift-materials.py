#!/usr/bin/env python3
"""Validate an explicit generated Electron teaching-version fixture with Swift."""
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
if len(sys.argv) != 2:
    raise SystemExit("Pass the TEACHSHELF_MATERIAL_ROUNDTRIP JSON file.")
fixture = Path(sys.argv[1]).resolve(strict=True)
with tempfile.TemporaryDirectory(prefix="teachshelf-material-check-") as scratch:
    executable = Path(scratch) / "verify-materials"
    subprocess.run([
        "swiftc", "-swift-version", "5", "-parse-as-library",
        "-whole-module-optimization", "-Onone", "-module-cache-path", str(Path(scratch) / "ModuleCache"),
        *map(str, sorted((ROOT / "Sources/TeachshelfCore").rglob("*.swift"))),
        str(ROOT / "desktop/scripts/VerifyMaterialRoundtrip.swift"), "-o", str(executable),
    ], check=True, cwd=ROOT)
    subprocess.run([str(executable), str(fixture)], check=True, cwd=ROOT)
