#!/usr/bin/env python3
"""Generate a fixture by migrating a real Codable schema-8 library in Swift."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sources = sorted((ROOT / "Sources/TeachshelfCore").rglob("*.swift"))
with tempfile.TemporaryDirectory(prefix="teachshelf-homework-check-") as scratch:
    executable = Path(scratch) / "generate-homework"
    subprocess.run([
        "swiftc", "-swift-version", "5", "-parse-as-library",
        "-whole-module-optimization", "-Onone",
        "-module-cache-path", str(Path(scratch) / "ModuleCache"),
        *map(str, sources), str(ROOT / "desktop/scripts/GenerateHomeworkFixture.swift"),
        "-o", str(executable),
    ], check=True, cwd=ROOT)
    subprocess.run([str(executable), str(ROOT / "desktop/tests/fixtures/swift-homework-migration.json")], check=True, cwd=ROOT)
