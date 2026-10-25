import Foundation
import Security

// Only the Electron application's own service is accessible. Never touches the Swift app's items.
struct Request: Decodable {
    let operation: String
    let profile: String
    let allowInteraction: Bool
    let data: String?
}
func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
}
func fail(_ status: OSStatus) {
    emit(["ok": false, "code": Int(status), "message": "系统钥匙串暂不可用，可解锁后点击重试；仍可手动登录。"])
}
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count <= 120_000,
      let request = try? JSONDecoder().decode(Request.self, from: input),
      request.profile.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil,
      ["read", "write", "remove"].contains(request.operation) else {
    emit(["ok": false, "code": -1, "message": "无效的登录存储请求"])
    exit(1)
}
var query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.teachshelf.desktop.teaching-session",
    kSecAttrAccount as String: request.profile,
    kSecAttrSynchronizable as String: false,
    kSecUseAuthenticationUI as String: request.allowInteraction ? kSecUseAuthenticationUIAllow : kSecUseAuthenticationUIFail
]
// Also disables any legacy Security-framework UI in this helper process.
SecKeychainSetUserInteractionAllowed(request.allowInteraction)
switch request.operation {
case "read":
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { emit(["ok": true]) }
    else if status == errSecSuccess, let data = result as? Data, data.count <= 96_000,
            let value = String(data: data, encoding: .utf8) { emit(["ok": true, "data": value]) }
    else { fail(status == errSecSuccess ? errSecDecode : status) }
case "write":
    guard let text = request.data, let data = text.data(using: .utf8), data.count <= 96_000 else {
        emit(["ok": false, "code": -1, "message": "登录会话过大或无效"])
        exit(1)
    }
    let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrLabel as String: "Teachshell · 教学网站登录"]
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
        var addition = query
        attributes.forEach { addition[$0.key] = $0.value }
        status = SecItemAdd(addition as CFDictionary, nil)
    }
    if status == errSecSuccess { emit(["ok": true]) } else { fail(status) }
case "remove":
    let status = SecItemDelete(query as CFDictionary)
    if status == errSecSuccess || status == errSecItemNotFound { emit(["ok": true]) } else { fail(status) }
default: break
}
