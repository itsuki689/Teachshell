import Foundation
import CryptoKit

// Compiled together with the unchanged production core, deliberately without a
// second hand-written copy of its models or JSONEncoder configuration.
@main struct GenerateSwiftFixtures {
    static let fm = FileManager.default
    static func id(_ tail: String) -> UUID { UUID(uuidString: "11111111-2222-4333-8444-" + tail)! }
    static func date(_ text: String) -> Date { ISO8601DateFormatter().date(from: text)! }

    static func main() throws {
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try fm.createDirectory(at: output, withIntermediateDirectories: true)
        let scratch = fm.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("Teachshelf-compat-\(UUID())")
        try fm.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: scratch) }

        let epochDate = date("2026-10-05T02:30:00Z").addingTimeInterval(0.125)
        var course = Course(id: id("000000000001"), name: "计算机网络", semester: "2026 秋季", teacher: "测试教师", colorHex: "#39786B")
        course.materialSort = .name
        var folder = MaterialFolder(id: id("000000000002"), courseID: course.id, name: "第一章", colorHex: "#39786B", createdAt: epochDate)
        // Test an explicit Finder rename: do not reconstruct its path from name.
        folder.storageDirectory = "files/计算机网络 [\(course.id)]/资料/第一章"
        let emptyFolder = MaterialFolder(id: id("000000000003"), courseID: course.id, parentID: folder.id, name: "空目录", createdAt: epochDate)
        let payload = Data("Swift fixture: 课程资料与 Unicode e\u{301} 🌊\n".utf8)
        var material = MaterialRecord(id: id("000000000004"), courseID: course.id, title: "网络概述", originalName: "网络概述.txt", sourcePath: "/original/网络概述.txt", storedPath: "", isManaged: true, tags: "复习,网络", notes: "保留原有备注", isFavorite: true, size: Int64(payload.count), addedAt: epochDate, lastOpenedAt: epochDate.addingTimeInterval(30))
        material.folderID = folder.id
        material.customOrder = 0
        material.storedPath = MaterialStorageLayout.relativePath(for: material, courses: [course], folders: [folder, emptyFolder])
        var external = MaterialRecord(id: id("000000000005"), courseID: course.id, title: "外部参考", originalName: "reference.pdf", sourcePath: "/original/reference.pdf", storedPath: "/original/reference.pdf", isManaged: false, category: "参考资料", addedAt: epochDate)
        external.folderID = emptyFolder.id
        var plan = StudyTask(id: id("000000000006"), title: "网络课程复习", content: "真实 Codable 测试样例", kind: "任务", courseID: course.id, materialIDs: [material.id], startsAt: epochDate, deadline: epochDate.addingTimeInterval(86400), isAllDay: false, courseNameSnapshot: course.name, endsAt: epochDate.addingTimeInterval(3600), location: "图书馆", showInMonth: true, repeatRule: PlanRepeatRule(frequency: .weekly, until: epochDate.addingTimeInterval(28 * 86400)), deadlineIsAllDay: false, colorHex: "#39786B")
        let originalDate = epochDate.addingTimeInterval(7 * 86400)
        var modified = plan
        modified.title = "调整后的复习"
        modified.startsAt = originalDate.addingTimeInterval(3600)
        modified.endsAt = modified.startsAt.addingTimeInterval(3600)
        plan.exceptions = [.init(originalDate: originalDate, details: PlanDetails(modified, comparedTo: plan), completedOverride: false)]
        var meeting = TimetableMeeting(id: id("000000000007"), courseID: course.id, courseCode: "CS101", title: course.name, teacher: course.teacher, classroom: "教学楼 101", weeks: [1, 2, 3, 4], weekday: 1, startSection: 3, sectionCount: 2, note: "单双周按 weeks 数组保存", showInMonth: true)
        meeting.colorHex = "#39786B"
        let monday = date("2026-10-04T16:00:00Z")
        var movedMeeting = meeting
        movedMeeting.weekday = 2
        let term = TimetableTerm(id: id("000000000008"), name: "2026 秋季", weekOneMonday: monday, weekCount: 20, sectionTimes: UndergraduateTimetableDefaults.sectionTimes, meetings: [meeting], cancellations: [.init(id: id("000000000009"), meetingID: meeting.id, date: monday.addingTimeInterval(7 * 86400), title: course.name, reason: "测试停课")], reschedules: [.init(id: id("000000000010"), meetingID: meeting.id, originalDate: monday.addingTimeInterval(14 * 86400), date: monday.addingTimeInterval(15 * 86400), meeting: movedMeeting)])
        var connection = TeachingConnection(id: id("000000000011"), courseID: course.id, remoteCourseID: "12345", remoteTitle: course.name, accountID: "202600001")
        connection.lastSyncAt = epochDate
        var item = TeachingItemLink(id: "file:resource:456", localID: material.id, title: material.title)
        item.digest = SHA256.hash(data: payload).map { String(format: "%02x", $0) }.joined()
        item.folderID = folder.id
        connection.items = [item]
        connection.folders = [TeachingFolderLink(key: "section:1", localID: folder.id)]

        var modern = LibraryState()
        modern.courses = [course]; modern.materialFolders = [folder, emptyFolder]
        modern.materials = [material, external]; modern.tasks = [plan]
        modern.timetableTerms = [term]; modern.teachingConnections = [connection]
        modern.customCategories = ["实验记录"]
        let modernBytes = try LibraryRepository.encoder.encode(modern)
        let modernDecoded = try LibraryRepository.decode(modernBytes)
        precondition(modernDecoded == modern)

        var legacy = modern
        legacy.schemaVersion = 6; legacy.teachingConnections = []
        legacy.courses[0].materialSort = nil
        legacy.materialFolders[0].storageDirectory = nil
        legacy.materials[0].storedPath = "files/legacy/\(material.id)-网络概述.txt"
        legacy.materials[0].customOrder = nil
        let legacyBytes = try LibraryRepository.encoder.encode(legacy)

        // Early development used ISO dates and omitted newly introduced fields.
        let isoEncoder = JSONEncoder()
        isoEncoder.dateEncodingStrategy = .custom { value, encoder in
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var container = encoder.singleValueContainer()
            try container.encode(formatter.string(from: value))
        }
        var early = try JSONSerialization.jsonObject(with: isoEncoder.encode(legacy)) as! [String: Any]
        early["schemaVersion"] = 1
        for key in ["materialFolders", "teachingConnections", "timetableTerms", "appearanceTransition", "toolbarSettings", "showCourseBorders"] { early.removeValue(forKey: key) }
        var earlyMaterials = early["materials"] as! [[String: Any]]
        for i in earlyMaterials.indices { earlyMaterials[i].removeValue(forKey: "folderID") }
        early["materials"] = earlyMaterials
        var earlyTasks = early["tasks"] as! [[String: Any]]
        for i in earlyTasks.indices {
            for key in ["origin", "hasExecutionTime", "endsAt", "location", "showInMonth", "repeatRule", "completionRequired", "cancelledAt", "deadlineIsAllDay", "exceptions", "colorHex"] { earlyTasks[i].removeValue(forKey: key) }
        }
        early["tasks"] = earlyTasks
        let earlyBytes = try JSONSerialization.data(withJSONObject: early, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        let earlyDecoded = try LibraryRepository.decode(earlyBytes)
        precondition(earlyDecoded.schemaVersion == 6)
        precondition(earlyDecoded.tasks[0].hasExecutionTime == false)
        precondition(earlyDecoded.tasks[0].deadlineIsAllDay == false)
        precondition(earlyDecoded.tasks[0].exceptions.isEmpty)

        let variants: [(String, Data)] = [("schema9", modernBytes), ("schema6", legacyBytes), ("legacy-iso", earlyBytes)]
        var results: [[String: Any]] = []
        for (name, bytes) in variants {
            let decoded = try LibraryRepository.decode(bytes)
            let library = scratch.appendingPathComponent(name)
            try fm.createDirectory(at: library, withIntermediateDirectories: true)
            try bytes.write(to: library.appendingPathComponent("library.json"))
            let directories = MaterialStorageLayout.Directories(courses: decoded.courses, folders: decoded.materialFolders)
            for path in directories.required(in: decoded) {
                try fm.createDirectory(at: library.appendingPathComponent(path), withIntermediateDirectories: true)
            }
            let file = library.appendingPathComponent(decoded.materials[0].storedPath)
            try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try payload.write(to: file)
            let repo = try LibraryRepository(root: library)
            precondition(repo.state.schemaVersion == 9)
            let preservedBytes = try Data(contentsOf: repo.resolveURL(repo.state.materials[0]))
            precondition(preservedBytes == payload)
            precondition(repo.state.materials[0].id == material.id && repo.state.materials[0].notes == material.notes)
            precondition(repo.state.materials[1].storedPath == external.storedPath)
            results.append(["fixture": "swift-\(name).json", "swiftRepositoryOpened": true, "resultSchemaVersion": repo.state.schemaVersion, "managedBytesPreserved": true, "resultStoredPath": repo.state.materials[0].storedPath])
        }
        let contract: [String: Any] = [
            "generator": "desktop/scripts/GenerateSwiftFixtures.swift compiled with unchanged Sources/TeachshelfCore",
            "swiftReferenceEpochUnixSeconds": 978307200,
            "date": ["iso": "2026-10-05T02:30:00.125Z", "swift": epochDate.timeIntervalSinceReferenceDate, "unixMilliseconds": epochDate.timeIntervalSince1970 * 1000],
            "managedFile": ["content": String(decoding: payload, as: UTF8.self), "size": payload.count, "sha256": item.digest, "schema9Path": material.storedPath, "schema6Path": legacy.materials[0].storedPath],
            "validation": results
        ]
        try modernBytes.write(to: output.appendingPathComponent("swift-schema9.json"))
        try legacyBytes.write(to: output.appendingPathComponent("swift-schema6.json"))
        try earlyBytes.write(to: output.appendingPathComponent("swift-legacy-iso.json"))
        try JSONSerialization.data(withJSONObject: contract, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]).write(to: output.appendingPathComponent("swift-compatibility-contract.json"))
        print("PASS: 3 fixtures encoded with production Swift models; all opened/migrated by LibraryRepository; IDs, external paths, notes and file bytes preserved.")
    }
}
