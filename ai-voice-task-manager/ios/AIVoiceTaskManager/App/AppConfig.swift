import Foundation

/// Build-time configuration. Secrets never live here: only the public Supabase URL and anon key
/// (the Gemini key stays on the backend, see spec §32).
enum AppConfig {
    static var supabaseURL: URL {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String) ?? ""
        return URL(string: raw) ?? URL(string: "https://invalid.local")!
    }
    static var supabaseAnonKey: String {
        (Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String) ?? ""
    }
    static let appGroup = "group.com.example.aivoicetasks"
    static let urlScheme = "aivoicetasks"
    static let processingTaskId = "com.example.aivoicetasks.process"
    static let briefingNotificationId = "daily-briefing"
}
