import CryptoKit
import Foundation

struct Session: Codable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var userId: UUID
    var email: String?
    var isExpiringSoon: Bool { expiresAt.timeIntervalSinceNow < 60 }
}

enum SupabaseError: LocalizedError {
    case notAuthenticated
    case http(Int, String)
    case decoding(String)
    case offline

    var errorDescription: String? {
        switch self {
        case .notAuthenticated: "Нужно войти в аккаунт"
        case .http(let code, let body): "Ошибка сервера \(code): \(body.prefix(200))"
        case .decoding(let m): "Не удалось прочитать ответ: \(m)"
        case .offline: "Нет сети"
        }
    }
}

/// Minimal Supabase client: GoTrue auth, PostgREST and Edge Functions over URLSession.
/// Kept dependency-free so the project builds with no SPM packages.
actor SupabaseClient {
    private let baseURL: URL
    private let anonKey: String
    private let urlSession: URLSession
    private(set) var session: Session?
    private let sessionKey = "supabase.session"

    init(baseURL: URL = AppConfig.supabaseURL, anonKey: String = AppConfig.supabaseAnonKey) {
        self.baseURL = baseURL
        self.anonKey = anonKey
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 120
        cfg.waitsForConnectivity = false
        urlSession = URLSession(configuration: cfg)
        if let data = Keychain.get(sessionKey), let s = try? JSONDecoder().decode(Session.self, from: data) { session = s }
    }

    var isAuthenticated: Bool { session != nil }
    var userId: UUID? { session?.userId }

    // MARK: Auth

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Double
        let user: User
        struct User: Decodable { let id: UUID; let email: String? }
    }

    private func store(_ t: TokenResponse) {
        let s = Session(accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date().addingTimeInterval(t.expires_in), userId: t.user.id, email: t.user.email)
        session = s
        if let data = try? JSONEncoder().encode(s) { Keychain.set(data, for: sessionKey) }
    }

    func signInWithApple(idToken: String, nonce: String) async throws {
        let body = ["provider": "apple", "id_token": idToken, "nonce": nonce]
        let data = try await raw("auth/v1/token?grant_type=id_token", method: "POST", body: try JSONSerialization.data(withJSONObject: body), authenticated: false)
        store(try JSONDecoder().decode(TokenResponse.self, from: data))
    }

    /// OAuth (Google etc.) with PKCE: returns the URL to open in ASWebAuthenticationSession and the verifier to keep.
    func oauthURL(provider: String, redirectTo: String) -> (url: URL, verifier: String) {
        let verifier = Self.randomString(64)
        let challenge = Self.base64URL(Self.sha256(Data(verifier.utf8)))
        var comps = URLComponents(url: baseURL.appendingPathComponent("auth/v1/authorize"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "provider", value: provider),
            URLQueryItem(name: "redirect_to", value: redirectTo),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "select_account"),
        ]
        return (comps.url!, verifier)
    }

    func exchangeCode(_ code: String, verifier: String) async throws {
        let body = ["auth_code": code, "code_verifier": verifier]
        let data = try await raw("auth/v1/token?grant_type=pkce", method: "POST", body: try JSONSerialization.data(withJSONObject: body), authenticated: false)
        store(try JSONDecoder().decode(TokenResponse.self, from: data))
    }

    private static func randomString(_ n: Int) -> String {
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        var bytes = [UInt8](repeating: 0, count: n)
        _ = SecRandomCopyBytes(kSecRandomDefault, n, &bytes)
        return String(bytes.map { chars[Int($0) % chars.count] })
    }
    private static func sha256(_ d: Data) -> Data { Data(SHA256.hash(data: d)) }
    private static func base64URL(_ d: Data) -> String { d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }

    func sendEmailOTP(email: String) async throws {
        let body: [String: Any] = ["email": email, "create_user": true]
        _ = try await raw("auth/v1/otp", method: "POST", body: try JSONSerialization.data(withJSONObject: body), authenticated: false)
    }

    func verifyEmailOTP(email: String, code: String) async throws {
        let body = ["email": email, "token": code, "type": "email"]
        let data = try await raw("auth/v1/verify", method: "POST", body: try JSONSerialization.data(withJSONObject: body), authenticated: false)
        store(try JSONDecoder().decode(TokenResponse.self, from: data))
    }

    func signOut() async {
        if session != nil { _ = try? await raw("auth/v1/logout", method: "POST", body: nil, authenticated: true) }
        session = nil
        Keychain.delete(sessionKey)
    }

    func refreshIfNeeded() async throws {
        guard let s = session else { throw SupabaseError.notAuthenticated }
        guard s.isExpiringSoon else { return }
        let body = ["refresh_token": s.refreshToken]
        let data = try await raw("auth/v1/token?grant_type=refresh_token", method: "POST", body: try JSONSerialization.data(withJSONObject: body), authenticated: false)
        store(try JSONDecoder().decode(TokenResponse.self, from: data))
    }

    // MARK: PostgREST

    func select(_ table: String, query: [URLQueryItem]) async throws -> Data {
        try await rest(table, method: "GET", query: query, body: nil, prefer: nil)
    }

    func upsert(_ table: String, rows: Data, onConflict: String = "id") async throws -> Data {
        try await rest(table, method: "POST", query: [URLQueryItem(name: "on_conflict", value: onConflict)], body: rows, prefer: "resolution=merge-duplicates,return=representation")
    }

    func update(_ table: String, id: UUID, patch: Data) async throws {
        _ = try await rest(table, method: "PATCH", query: [URLQueryItem(name: "id", value: "eq.\(id.uuidString.lowercased())")], body: patch, prefer: "return=minimal")
    }

    func delete(_ table: String, id: UUID) async throws {
        _ = try await rest(table, method: "DELETE", query: [URLQueryItem(name: "id", value: "eq.\(id.uuidString.lowercased())")], body: nil, prefer: "return=minimal")
    }

    func rpc(_ name: String, params: [String: Any]) async throws -> Data {
        try await rest("rpc/\(name)", method: "POST", query: [], body: try JSONSerialization.data(withJSONObject: params), prefer: nil)
    }

    private func rest(_ path: String, method: String, query: [URLQueryItem], body: Data?, prefer: String?) async throws -> Data {
        var comps = URLComponents(url: baseURL.appendingPathComponent("rest/v1/\(path)"), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        var headers: [String: String] = ["Content-Type": "application/json"]
        if let prefer { headers["Prefer"] = prefer }
        return try await raw(url: comps.url!, method: method, body: body, authenticated: true, extraHeaders: headers)
    }

    // MARK: Edge Functions

    func invoke(_ function: String, body: Data) async throws -> Data {
        try await raw("functions/v1/\(function)", method: "POST", body: body, authenticated: true, extraHeaders: ["Content-Type": "application/json", "x-timezone": TimeZone.current.identifier])
    }

    // MARK: Storage

    func uploadAudio(path: String, data: Data, mimeType: String) async throws {
        _ = try await raw("storage/v1/object/audio/\(path)", method: "POST", body: data, authenticated: true, extraHeaders: ["Content-Type": mimeType, "x-upsert": "true"])
    }

    func deleteAudio(path: String) async throws {
        _ = try await raw("storage/v1/object/audio/\(path)", method: "DELETE", body: nil, authenticated: true)
    }

    // MARK: Core

    private func raw(_ path: String, method: String, body: Data?, authenticated: Bool, extraHeaders: [String: String] = ["Content-Type": "application/json"]) async throws -> Data {
        try await raw(url: baseURL.appendingPathComponent(path), method: method, body: body, authenticated: authenticated, extraHeaders: extraHeaders)
    }

    private func raw(url: URL, method: String, body: Data?, authenticated: Bool, extraHeaders: [String: String]) async throws -> Data {
        if authenticated { try await refreshIfNeeded() }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpBody = body
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        if authenticated, let token = session?.accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        else { req.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization") }
        for (k, v) in extraHeaders { req.setValue(v, forHTTPHeaderField: k) }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await urlSession.data(for: req) }
        catch let e as URLError where e.code == .notConnectedToInternet || e.code == .networkConnectionLost { throw SupabaseError.offline }
        guard let http = response as? HTTPURLResponse else { throw SupabaseError.http(0, "no response") }
        if http.statusCode == 401, authenticated, session != nil {
            session = nil
            Keychain.delete(sessionKey)
            throw SupabaseError.notAuthenticated
        }
        guard (200..<300).contains(http.statusCode) else { throw SupabaseError.http(http.statusCode, String(data: data, encoding: .utf8) ?? "") }
        return data
    }
}
