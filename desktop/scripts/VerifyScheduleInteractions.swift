import Foundation

/// Executes the unchanged production Swift mutations against generated, disposable test data.
@main struct VerifyScheduleInteractions {
    static func main() throws {
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        let cases = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
        for item in cases {
            let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
                .appendingPathComponent("Teachshell-interaction-parity-\(UUID())")
            defer { try? FileManager.default.removeItem(at: root) }
            let before = try LibraryRepository.decode(JSONSerialization.data(withJSONObject: item["before"]!))
            let expected = try LibraryRepository.decode(JSONSerialization.data(withJSONObject: item["after"]!))
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try LibraryRepository.encoder.encode(before).write(to: root.appendingPathComponent("library.json"))
            let repository = try LibraryRepository(root: root)
            let termID = UUID(uuidString: item["termID"] as! String)!
            let meetingID = UUID(uuidString: item["meetingID"] as! String)!
            let action = item["action"] as! String
            switch action {
            case "weekly", "removed-weeks":
                let meeting = expected.timetableTerms.first(where: { $0.id == termID })!.meetings.first(where: { $0.id == meetingID })!
                try repository.updateTimetableMeeting(termID: termID, meeting: meeting)
            case "color": try repository.setTimetableMeetingColor(termID: termID, meetingID: meetingID, hex: "#AABBCC")
            case "inherit": try repository.setTimetableMeetingColor(termID: termID, meetingID: meetingID, hex: nil)
            case "delete": try repository.deleteTimetableMeeting(termID: termID, meetingID: meetingID)
            default: fatalError("Unexpected test case")
            }
            guard repository.state.timetableTerms == expected.timetableTerms else {
                throw LibraryError.invalidInput("Swift/TypeScript mutation differs: \(action)")
            }
            print("PASS production Swift mutation parity: \(action)")
        }
    }
}
