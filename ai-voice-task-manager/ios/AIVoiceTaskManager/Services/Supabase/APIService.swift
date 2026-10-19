import Foundation

/// Typed wrappers over the Edge Functions. All AI calls go through here (spec §31–33).
struct APIService {
    let client: SupabaseClient
    private let decoder = ISO8601.decoder()
    private let encoder = ISO8601.encoder()

    private func call<T: Decodable>(_ fn: String, _ payload: [String: Any]) async throws -> T {
        let body = try JSONSerialization.data(withJSONObject: payload, options: [])
        let data = try await client.invoke(fn, body: body)
        do { return try decoder.decode(T.self, from: data) }
        catch { throw SupabaseError.decoding("\(fn): \(error)") }
    }

    private func call<T: Decodable, B: Encodable>(_ fn: String, encodable: B) async throws -> T {
        let body = try encoder.encode(encodable)
        let data = try await client.invoke(fn, body: body)
        do { return try decoder.decode(T.self, from: data) }
        catch { throw SupabaseError.decoding("\(fn): \(error)") }
    }

    func transcribe(audio: Data, mimeType: String, voiceEntryId: UUID?, languageHint: String?, liveTranscript: String?) async throws -> TranscribeResponse {
        var p: [String: Any] = ["audio_base64": audio.base64EncodedString(), "mime_type": mimeType]
        if let voiceEntryId { p["voice_entry_id"] = voiceEntryId.uuidString.lowercased() }
        if let languageHint { p["language_hint"] = languageHint }
        if let liveTranscript { p["live_transcript"] = liveTranscript }
        return try await call("transcribe", p)
    }

    func parse(transcript: String, originalTranscript: String?, voiceEntryId: UUID?) async throws -> ParseResponse {
        var p: [String: Any] = ["transcript": transcript]
        if let originalTranscript { p["original_transcript"] = originalTranscript }
        if let voiceEntryId { p["voice_entry_id"] = voiceEntryId.uuidString.lowercased() }
        return try await call("parse", p)
    }

    struct CommitBody: Encodable { var voiceEntryId: String?; var items: [ResolvedItem]; var originalTranscript: String?; var cleanTranscript: String? }
    func commit(items: [ResolvedItem], voiceEntryId: UUID?, originalTranscript: String?, cleanTranscript: String?) async throws -> CommitResponse {
        try await call("commit", encodable: CommitBody(voiceEntryId: voiceEntryId?.uuidString.lowercased(), items: items, originalTranscript: originalTranscript, cleanTranscript: cleanTranscript))
    }

    struct ChatBody: Encodable {
        struct Turn: Encodable { var role: String; var content: String }
        var message: String; var history: [Turn]; var conversationId: String?
    }
    func chat(message: String, history: [(role: String, content: String)], conversationId: UUID) async throws -> ChatResponse {
        try await call("chat", encodable: ChatBody(message: message, history: history.map { .init(role: $0.role, content: $0.content) }, conversationId: conversationId.uuidString.lowercased()))
    }

    struct ActionsBody: Encodable { struct Action: Encodable { var name: String; var args: JSONValue }; var actions: [Action]; var description: String? }
    func executeActions(_ actions: [PendingAction], description: String?) async throws -> ExecuteActionsResponse {
        try await call("execute-actions", encodable: ActionsBody(actions: actions.map { .init(name: $0.name, args: $0.args) }, description: description))
    }

    func undo(batchId: String) async throws -> Int {
        struct R: Decodable { var undone: Int }
        let r: R = try await call("undo", ["batch_id": batchId])
        return r.undone
    }

    func briefing() async throws -> BriefingResponse { try await call("briefing", [:]) }

    func search(_ query: String, limit: Int = 20) async throws -> SearchResponse { try await call("search", ["query": query, "limit": limit]) }

    func embedMissing() async throws { struct R: Decodable { var embedded: Int }; let _: R = try await call("embed", ["all_missing": true]) }

    func news(topic: String, refresh: Bool = false, digest: Bool = false) async throws -> NewsResponse { try await call("news", ["topic": topic, "refresh": refresh, "digest": digest]) }

    func mailOAuthURL(provider: String) async throws -> URL {
        struct R: Decodable { var url: String }
        let r: R = try await call("mail-oauth", ["provider": provider, "return_url": "\(AppConfig.urlScheme)://mail-connected"])
        guard let url = URL(string: r.url) else { throw SupabaseError.decoding("oauth url") }
        return url
    }
    func mailSync() async throws -> MailSyncResponse { try await call("mail-sync", [:]) }
    func mailRemove(accountId: String) async throws { struct R: Decodable { var ok: Bool }; let _: R = try await call("mail-connect", ["action": "remove", "account_id": accountId]) }
    func mailConnectIMAP(email: String, host: String, port: Int, secure: Bool, username: String, password: String) async throws {
        struct R: Decodable { var ok: Bool }
        let _: R = try await call("mail-connect", ["action": "imap", "email": email, "host": host, "port": port, "secure": secure, "username": username, "password": password])
    }
}
