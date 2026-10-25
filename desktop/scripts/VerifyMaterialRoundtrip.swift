import Foundation

/// Validates a generated Electron state using the unchanged production models.
@main struct VerifyMaterialRoundtrip {
    static func main() throws {
        let bytes = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        let state = try LibraryRepository.decode(bytes)
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("Teachshelf-material-check-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LibraryRepository(root: root)
        try repository.validate(state)
        let decoded = try LibraryRepository.decode(LibraryRepository.encoder.encode(state))
        precondition(decoded == state, "Native known fields must roundtrip unchanged")
        precondition(state.materials.count == 3 && Set(state.materials.map(\.sourcePath)).count == 1)
        let connection = state.teachingConnections[0]
        precondition(connection.items.count == 1 && connection.items[0].localID != nil)
        precondition(state.materials.contains { $0.id == connection.items[0].localID })
        precondition(state.materialFolders.contains { $0.name == "历史版本" })
        print("PASS: production Swift decodes, validates and roundtrips 3 Electron teaching versions, shared source identity, folders, current binding, dates and material metadata.")
    }
}
