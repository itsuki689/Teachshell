import Foundation
import CryptoKit

/// Records the actual native migration result for a fixed schema-8 library.
@main struct GenerateHomeworkFixture {
    static let fm = FileManager.default
    static func main() throws {
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        let root = fm.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("Teachshelf-homework-fixture-\(UUID())")
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let course = Course(id: UUID(uuidString: "11111111-2222-4333-8444-000000000101")!, name: "数学", semester: "2026 秋季", teacher: "测试教师")
        var state = LibraryState(); state.schemaVersion = 8; state.courses = [course]
        let legacy = "HomeworkFiles/\(course.id.uuidString)"
        let target = MaterialStorageLayout.homeworkPath(for: course)
        let old = "files/旧数学 [\(course.id.uuidString)]/作业"
        var entries: [[String: Any]] = []
        func file(_ relative: String, _ data: Data) throws {
            let url = root.appendingPathComponent(relative)
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url)
            entries.append(["path": relative, "dataBase64": data.base64EncodedString()])
        }
        func text(_ relative: String, _ value: String) throws { try file(relative, Data(value.utf8)) }
        try text(legacy + "/实验/answer.txt", "old answer")
        try text(legacy + "/实验/shared.txt", "same")
        try text(legacy + "/实验/.config", "hidden config")
        try text(legacy + "/代码/main.py", "print('旧代码')\n")
        try file(legacy + "/实验/二进制🌊.bin", Data([0, 255, 128, 10, 42]))
        try fm.createDirectory(at: root.appendingPathComponent(legacy + "/空目录"), withIntermediateDirectories: true)
        entries.append(["path": legacy + "/空目录", "directory": true])
        try text("HomeworkFiles/Unassigned/public.txt", "public homework")
        try text(target + "/实验/answer.txt", "new answer")
        try text(target + "/实验/shared.txt", "same")
        try text(target + "/代码", "keep file")
        try text(old + "/extra.txt", "old course path")
        let bytes = try LibraryRepository.encoder.encode(state)
        try bytes.write(to: root.appendingPathComponent("library.json"))
        let repository = try LibraryRepository(root: root)
        precondition(repository.state.schemaVersion == 9)
        var expected: [[String: Any]] = []
        func visit(_ relative: String) throws {
            let url = root.appendingPathComponent(relative)
            let directory = try url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true
            if directory {
                expected.append(["path": relative, "directory": true])
                for child in try fm.contentsOfDirectory(atPath: url.path).sorted() { try visit(relative + "/" + child) }
            } else {
                let data = try Data(contentsOf: url)
                expected.append(["path": relative, "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), "dataBase64": data.base64EncodedString()])
            }
        }
        try visit(target)
        try visit(MaterialStorageLayout.homeworkPath(for: nil))
        let contract: [String: Any] = [
            "generator": "GenerateHomeworkFixture.swift with unchanged production LibraryRepository",
            "library": try JSONSerialization.jsonObject(with: bytes),
            "entries": entries, "expected": expected
        ]
        try JSONSerialization.data(withJSONObject: contract, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]).write(to: output)
        print("PASS: native Swift schema-8 homework migration generated \(expected.count) expected files/directories with conflict, hidden, empty, binary and public cases.")
    }
}
