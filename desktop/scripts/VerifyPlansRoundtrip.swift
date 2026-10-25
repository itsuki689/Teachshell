import Foundation

/// Differential check against the unchanged production Swift implementation.
/// All mutations use generated test data in disposable repositories.
@main struct VerifyPlansRoundtrip {
    static func date(_ value: Any?) -> Date? {
        (value as? NSNumber).map { Date(timeIntervalSinceReferenceDate: $0.doubleValue) }
    }

    static func apply(_ operation: [String: Any], to repository: LibraryRepository) throws {
        let scope = PlanEditScope(rawValue: operation["scope"] as? String ?? "all")!
        let original = date(operation["originalDate"])
        let kind = operation["kind"] as! String
        if kind == "save" {
            let input = operation["input"] as! [String: Any]
            let id = (input["id"] as? String).flatMap(UUID.init(uuidString:))
            let parent = repository.state.tasks.first { $0.id == id }
            let base: StudyTask
            if let parent, scope != .all, let original {
                base = PlanCalendar.snapshot(of: parent, originalDate: original)
            } else { base = parent ?? StudyTask(title: "") }
            var merged = try JSONSerialization.jsonObject(with: LibraryRepository.encoder.encode(base)) as! [String: Any]
            for (key, value) in input { merged[key] = value }
            let task = try JSONDecoder().decode(StudyTask.self, from: JSONSerialization.data(withJSONObject: merged))
            try repository.savePlan(task, originalDate: original, scope: scope)
            return
        }
        let id = UUID(uuidString: operation["id"] as! String)!
        if kind == "delete" { try repository.deletePlan(id: id, originalDate: original, scope: scope); return }
        switch operation["status"] as! String {
        case "complete", "reopen":
            let completed = operation["status"] as! String == "complete"
            if scope == .thisOccurrence { try repository.setPlanOccurrenceCompleted(id: id, originalDate: original!, completed: completed) }
            else { try repository.setTaskCompleted(id: id, completed: completed) }
        case "cancel": try repository.cancelPlan(id: id, originalDate: original, scope: scope)
        case "restore":
            if scope == .thisOccurrence { try repository.setPlanOccurrenceCancelled(id: id, originalDate: original!, cancelled: false) }
            else {
                var task = repository.state.tasks.first { $0.id == id }!
                task.cancelledAt = nil
                try repository.savePlan(task)
            }
        case "archive": try repository.archiveTask(id: id)
        case "unarchive": try repository.restoreTask(id: id)
        case "resetOccurrence": try repository.restorePlanOccurrence(id: id, originalDate: original!)
        default: throw LibraryError.invalidInput("Unknown generated operation")
        }
    }

    static func compare(_ expected: [[String: Any]], plans: [StudyTask], label: String) throws {
        for entry in expected {
            let day = date(entry["day"])!
            let actual: [[String: Any]] = PlanCalendar.events(on: day, plans: plans).map { occurrence in
                [
                    "title": occurrence.task.title,
                    "content": occurrence.task.content,
                    "location": occurrence.task.location,
                    "colorHex": occurrence.task.colorHex as Any? ?? NSNull(),
                    "date": occurrence.date.timeIntervalSinceReferenceDate,
                    "endDate": occurrence.endDate?.timeIntervalSinceReferenceDate as Any? ?? NSNull(),
                    "originalDate": occurrence.originalDate.timeIntervalSinceReferenceDate,
                    "isDeadline": occurrence.isDeadline,
                    "isAllDay": occurrence.isAllDay,
                    "isCompleted": occurrence.task.completedAt != nil,
                    "isFixed": occurrence.isFixed
                ]
            }
            let wanted = entry["events"] as! [[String: Any]]
            guard (actual as NSArray).isEqual(to: wanted) else {
                print("Mismatch \(label) at \(day):\nSwift: \(actual)\nTypeScript: \(wanted)")
                throw LibraryError.invalidInput("Swift/TypeScript plans differ")
            }
        }
    }

    static func main() throws {
        let input = URL(fileURLWithPath: CommandLine.arguments[1])
        let bundle = try JSONSerialization.jsonObject(with: Data(contentsOf: input)) as! [String: Any]
        let cases = bundle["cases"] as! [[String: Any]]
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("Teachshelf-plans-roundtrip-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        var projections = 0
        for (index, item) in cases.enumerated() {
            let label = item["name"] as! String
            let expected = item["expected"] as! [[String: Any]]
            let final = try LibraryRepository.decode(JSONSerialization.data(withJSONObject: item["state"]!))
            let repository = try LibraryRepository(root: root.appendingPathComponent(String(index)))
            try repository.validate(final)
            let encoded = try LibraryRepository.encoder.encode(final)
            let decoded = try LibraryRepository.decode(encoded)
            precondition(final == decoded, "Swift Codable roundtrip lost plan fields")
            try compare(expected, plans: decoded.tasks, label: "\(label) / decoded TS state")
            let initial = try LibraryRepository.decode(JSONSerialization.data(withJSONObject: item["initial"]!))
            for task in initial.tasks { try repository.savePlan(task) }
            for operation in item["operations"] as! [[String: Any]] { try apply(operation, to: repository) }
            try compare(expected, plans: repository.state.tasks, label: "\(label) / native mutations")
            projections += expected.count
        }
        print("PASS: \(cases.count) plan cases decode/validate/re-encode without loss; \(projections) dates agree for both TypeScript state and actual native Swift mutations.")
    }
}
