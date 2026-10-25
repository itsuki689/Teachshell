import Foundation

/// Uses only the generated fixture bundle and disposable native repositories.
@main struct VerifyTeachingRoundtrip {
    static func optional(_ value: Date?) -> Any { value.map { $0.timeIntervalSinceReferenceDate } as Any? ?? NSNull() }
    static func projection(_ state: LibraryState) -> [String: Any] {
        let tasks: [[String: Any]] = state.tasks.map { p in
            ["title": p.title, "content": p.content, "kind": p.kind, "origin": p.origin.rawValue,
             "hasExecutionTime": p.hasExecutionTime, "startsAt": p.hasExecutionTime ? p.startsAt.timeIntervalSinceReferenceDate as Any : NSNull(),
             "deadline": optional(p.deadline), "deadlineIsAllDay": p.deadlineIsAllDay,
             "completedAt": optional(p.completedAt), "archivedAt": optional(p.archivedAt), "materialIDs": p.materialIDs.map(\.uuidString)]
        }
        let links: [[String: Any]] = state.teachingConnections.flatMap { c in c.items.map { i in
            let pending: Any = i.pendingDeadline.map { ["date": optional($0.date), "allDay": $0.allDay, "text": $0.text] as [String: Any] } as Any? ?? NSNull()
            return ["id": i.id, "title": i.title, "content": i.content, "ignored": i.ignored, "submitted": i.submitted,
                    "remoteDeadline": optional(i.remoteDeadline), "appliedDeadline": optional(i.appliedDeadline),
                    "remoteDeadlineIsAllDay": i.remoteDeadlineIsAllDay as Any? ?? NSNull(),
                    "appliedDeadlineIsAllDay": i.appliedDeadlineIsAllDay as Any? ?? NSNull(),
                    "pendingDeadline": pending, "hasLocalPlan": state.tasks.contains { $0.id == i.localID }] as [String: Any]
        }}
        return ["tasks": tasks, "links": links]
    }
    static func main() throws {
        let bundle = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
        let cases = bundle["cases"] as! [[String: Any]]
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("Teachshelf-teaching-check-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        for (index, item) in cases.enumerated() {
            let repository = try LibraryRepository(root: root.appendingPathComponent(String(index)))
            let initial = try LibraryRepository.decode(JSONSerialization.data(withJSONObject: item["initial"]!))
            let final = try LibraryRepository.decode(JSONSerialization.data(withJSONObject: item["state"]!))
            try repository.validate(final)
            let roundtrip = try LibraryRepository.decode(LibraryRepository.encoder.encode(final))
            precondition(final == roundtrip, "Swift Codable lost teaching data")
            try repository.saveSnapshot(initial)
            let activity = try JSONDecoder().decode(TeachingActivity.self, from: JSONSerialization.data(withJSONObject: item["activity"]!))
            let page = try JSONDecoder().decode(TeachingPage.self, from: JSONSerialization.data(withJSONObject: item["page"]!))
            _ = try repository.syncTeachingAssignment(connectionID: UUID(uuidString: item["connectionID"] as! String)!, activity: activity, page: page, now: Date(timeIntervalSinceReferenceDate: (item["now"] as! NSNumber).doubleValue))
            let actual = projection(repository.state), expected = item["expected"] as! [String: Any]
            guard (actual as NSDictionary).isEqual(to: expected) else {
                print("Mismatch \(item["name"]!):\nSwift: \(actual)\nTypeScript: \(expected)")
                throw LibraryError.invalidInput("Swift/TypeScript teaching merge differs")
            }
        }
        print("PASS: \(cases.count) teaching cases decode/validate/re-encode without loss and match actual native assignment merge results.")
    }
}
