#!/usr/bin/env python3
"""Compile the unchanged Swift core and encode compatibility fixtures on macOS.

This only writes generated test fixtures and temporary scratch files. It never
opens the user's library. The compiler/module cache stays in a temporary folder.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCES = sorted((ROOT / "Sources/TeachshelfCore").rglob("*.swift"))

with tempfile.TemporaryDirectory(prefix="teachshelf-swift-fixtures-") as scratch:
    executable = Path(scratch) / "generate-fixtures"
    subprocess.run([
        "swiftc", "-swift-version", "5", "-parse-as-library", "-whole-module-optimization", "-Onone",
        "-module-cache-path", str(Path(scratch) / "ModuleCache"),
        *map(str, SOURCES),
        str(ROOT / "desktop/scripts/GenerateSwiftFixtures.swift"),
        "-o", str(executable),
    ], check=True, cwd=ROOT)
    subprocess.run([str(executable), str(ROOT / "desktop/tests/fixtures")], check=True, cwd=ROOT)
