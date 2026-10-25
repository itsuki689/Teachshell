import Foundation

/// Reads only the generated test bundle. Validation uses a temporary empty
/// repository, never the user's library or the file passed as input.
@main struct VerifyTimetableRoundtrip {
    static func main() throws {
        let input = URL(fileURLWithPath: CommandLine.arguments[1])
        let bundle = try JSONSerialization.jsonObject(with: Data(contentsOf: input)) as! [String: Any]
        let stateBytes = try JSONSerialization.data(withJSONObject: bundle["state"]!)
        let state = try LibraryRepository.decode(stateBytes)
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("Teachshelf-timetable-roundtrip-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LibraryRepository(root: root)
        try repository.validate(state)
        let canonical = try LibraryRepository.encoder.encode(state)
        let decodedAgain = try LibraryRepository.decode(canonical)
        precondition(decodedAgain == state, "Swift Codable must round-trip all timetable records")

        let expected = bundle["expected"] as! [[String: Any]]
        for entry in expected {
            let date = Date(timeIntervalSinceReferenceDate: (entry["date"] as! NSNumber).doubleValue)
            var actual: [[String: Any]] = []
            for term in state.timetableTerms {
                for occurrence in term.occurrences(on: date) {
                    actual.append([
                        "termID": term.id.uuidString,
                        "meetingID": occurrence.meeting.id.uuidString,
                        "date": occurrence.date.timeIntervalSinceReferenceDate,
                        "originalDate": occurrence.originalDate.timeIntervalSinceReferenceDate,
                        "rescheduleID": occurrence.rescheduleID?.uuidString as Any? ?? NSNull()
                    ])
                }
            }
            let wanted = entry["events"] as! [[String: Any]]
            guard (actual as NSArray).isEqual(to: wanted) else {
                print("Projection mismatch at \(date):\nSwift: \(actual)\nTypeScript: \(wanted)")
                throw LibraryError.invalidInput("Swift/TypeScript timetable projection differs")
            }
        }
        print("PASS: TypeScript state decoded/validated/re-encoded by production Swift; \(state.timetableTerms.count) terms and \(expected.count) date projections agree.")
    }
}
