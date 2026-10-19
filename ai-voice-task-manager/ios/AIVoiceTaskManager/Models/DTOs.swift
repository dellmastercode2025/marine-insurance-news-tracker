import Foundation

// Wire formats shared with the backend (snake_case JSON). Mirrors backend/_shared/types.ts.

struct SemanticDate: Codable, Hashable {
    var day: String?
    var time: String?
    var text: String?
}

struct DisambiguationOption: Codable, Hashable, Identifiable {
    var project: String?
    var projectId: String?
    var area: String?
    var areaId: String?
    var id: String { "\(projectId ?? "")/\(areaId ?? "")" }
    var label: String { [project, area].compactMap { $0 }.joined(separator: " → ") }
}

/// One proposed item from /parse. Editable in the review screen, then sent to /commit.
struct ResolvedItem: Codable, Hashable, Identifiable {
    var clientId: String
    var type: TaskKind
    var title: String
    var description: String?
    var workspace: String?
    var project: String?
    var area: String?
    var subarea: String?
    var priority: Int?
    var priorityReason: String?
    var due: SemanticDate?
    var reminder: SemanticDate?
    var person: String?
    var organisation: String?
    var waitingFor: String?
    var waitingSubject: String?
    var tags: [String]?
    var confidence: Double
    var sourceQuote: String?
    var dueAt: String?
    var reminderAt: String?
    var followUpAt: String?
    var eventStartAt: String?
    var eventEndAt: String?
    var recurrenceRule: String?
    var workspaceId: String?
    var projectId: String?
    var areaId: String?
    var subareaId: String?
    var personId: String?
    var organisationId: String?
    var waitingForPersonId: String?
    var autoFile: Bool
    var needsDisambiguation: Bool
    var disambiguationOptions: [DisambiguationOption]?
    var warnings: [String]?

    var id: String { clientId }
    var dueDate: Date? { dueAt.flatMap(ISO8601.parse) }
    var reminderDate: Date? { reminderAt.flatMap(ISO8601.parse) }
    var eventStartDate: Date? { eventStartAt.flatMap(ISO8601.parse) }
    var priorityValue: Priority { Priority(rawValue: priority ?? 3) ?? .p3 }
    var categoryPath: String { [project, area, subarea].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " → ") }
}

struct ParseResponse: Codable {
    var voiceEntryId: String?
    var language: String
    var summary: String
    var items: [ResolvedItem]
    var needsReview: Bool
}

struct TranscribeResponse: Codable {
    var language: String
    var originalTranscript: String
    var cleanTranscript: String
}

struct CommitResponse: Codable {
    var batchId: String
    var tasks: [TaskDTO]
}

struct PendingAction: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var args: JSONValue
    var description: String
    var reason: String
}

struct ChatResponse: Codable {
    struct Executed: Codable { var name: String; var result: JSONValue? }
    var reply: String
    var executed: [Executed]
    var pendingActions: [PendingAction]
    var batchId: String?
}

struct ExecuteActionsResponse: Codable {
    struct Result: Codable { var name: String; var ok: Bool; var error: String?; var result: JSONValue? }
    var batchId: String
    var results: [Result]
}

struct BriefingResponse: Codable {
    struct Line: Codable, Identifiable { var taskId: String; var line: String; var id: String { taskId } }
    struct Slim: Codable, Identifiable {
        var id: String; var title: String; var priority: Int; var due: String?; var start: String?; var project: String?; var area: String?; var waitingFor: String?; var followUp: String?
    }
    var dateHuman: String
    var todayTotal: Int
    var urgent: Int
    var normal: Int
    var overdue: Int
    var waiting: Int
    var followUpsDue: Int
    var events: Int
    var headline: String
    var narrative: String
    var critical: [Line]
    var suggestedOrder: [String]
    var dueTodayList: [Slim]
    var eventsList: [Slim]
    var overdueList: [Slim]
    var waitingList: [Slim]
}

struct SearchResponse: Codable {
    struct Hit: Codable, Identifiable { var id: String; var title: String; var match: String?; var priority: Int?; var dueAt: String? }
    struct Named: Codable, Identifiable { var id: String; var name: String }
    var tasks: [Hit]
    var people: [Named]
    var projects: [Named]
}

/// Row shapes used by sync (PostgREST). Optional everywhere so partial rows decode.
struct TaskDTO: Codable {
    var id: UUID
    var userId: UUID?
    var kind: String?
    var title: String
    var description: String?
    var statusId: UUID?
    var priority: Int?
    var createdAt: Date?
    var updatedAt: Date?
    var startAt: Date?
    var dueAt: Date?
    var eventEndAt: Date?
    var completedAt: Date?
    var reminderAt: Date?
    var followUpAt: Date?
    var recurrenceRule: String?
    var workspaceId: UUID?
    var projectId: UUID?
    var areaId: UUID?
    var parentTaskId: UUID?
    var sourceId: UUID?
    var originalTranscript: String?
    var cleanTranscript: String?
    var aiConfidence: Double?
    var estimatedDurationMin: Int?
    var isWaiting: Bool?
    var waitingForPersonId: UUID?
    var waitingSubject: String?
    var personId: UUID?
    var organisationId: UUID?
    var tags: [String]?
    var calendarEventId: String?
    var appleReminderId: String?
    var deletedAt: Date?
}

struct WorkspaceDTO: Codable { var id: UUID; var userId: UUID?; var name: String; var sortOrder: Int?; var updatedAt: Date? }
struct ProjectDTO: Codable { var id: UUID; var userId: UUID?; var workspaceId: UUID; var name: String; var aliases: [String]?; var colorHex: String?; var isArchived: Bool?; var sortOrder: Int?; var updatedAt: Date? }
struct AreaDTO: Codable { var id: UUID; var userId: UUID?; var projectId: UUID; var parentAreaId: UUID?; var name: String; var aliases: [String]?; var sortOrder: Int?; var updatedAt: Date? }
struct OrganisationDTO: Codable { var id: UUID; var userId: UUID?; var name: String; var aliases: [String]?; var updatedAt: Date? }
struct PersonDTO: Codable { var id: UUID; var userId: UUID?; var name: String; var aliases: [String]?; var organisationId: UUID?; var role: String?; var notes: String?; var updatedAt: Date? }
struct StatusColumnDTO: Codable { var id: UUID; var userId: UUID?; var name: String; var kind: String; var sortOrder: Int?; var updatedAt: Date? }
struct VoiceEntryDTO: Codable {
    var id: UUID; var userId: UUID?; var createdAt: Date?; var updatedAt: Date?; var audioPath: String?; var durationSec: Double?
    var language: String?; var originalTranscript: String?; var cleanTranscript: String?; var processingStatus: String?; var aiSummary: String?
}
struct ReminderDTO: Codable { var id: UUID; var userId: UUID?; var taskId: UUID; var fireAt: Date; var repeatRule: String?; var kind: String?; var deliveredAt: Date?; var updatedAt: Date? }
struct PreferenceDTO: Codable {
    var userId: UUID?
    var timezone: String?; var language: String?
    var morningTime: String?; var dayTime: String?; var eveningTime: String?; var nightTime: String?; var endOfDayTime: String?
    var defaultPriority: Int?; var autoFileThreshold: Double?
    var aliases: [String: String]?; var routingRules: [String: String]?
    var deleteAudioAfterTranscription: Bool?; var privateMode: Bool?; var appleRemindersSync: String?; var briefingTime: String?
    var updatedAt: Date?
}

/// Minimal dynamic JSON value for tool arguments.
enum JSONValue: Codable, Hashable {
    case string(String), number(Double), bool(Bool), null
    case array([JSONValue]), object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else if let o = try? c.decode([String: JSONValue].self) { self = .object(o) }
        else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON") }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .null: try c.encodeNil()
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
    subscript(key: String) -> JSONValue? { if case .object(let o) = self { return o[key] } else { return nil } }
    var stringValue: String? { if case .string(let s) = self { return s } else { return nil } }
    var arrayValue: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
}

enum ISO8601 {
    private static let withFraction: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let plain: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()
    private static let postgres: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"; return f
    }()
    private static let postgresNoFraction: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ssxxx"; return f
    }()

    /// Accepts "2026-10-07T05:30:00Z", "+05:00" offsets and Postgres timestamps with 1–6 fractional digits.
    static func parse(_ raw: String) -> Date? {
        var s = raw.trimmingCharacters(in: .whitespaces)
        if let r = s.range(of: #"\.\d+"#, options: .regularExpression) {
            let digits = String(s[r].dropFirst()).prefix(3)
            s.replaceSubrange(r, with: "." + digits.padding(toLength: 3, withPad: "0", startingAt: 0))
        }
        if s.hasSuffix("+00") || s.hasSuffix("-00") { s += ":00" }
        return withFraction.date(from: s) ?? plain.date(from: s) ?? postgres.date(from: s) ?? postgresNoFraction.date(from: s)
    }
    static func string(_ d: Date) -> String { withFraction.string(from: d) }

    static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { dec in
            let c = try dec.singleValueContainer()
            let s = try c.decode(String.self)
            guard let date = ISO8601.parse(s) else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "Bad date \(s)") }
            return date
        }
        return d
    }
    static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        e.dateEncodingStrategy = .custom { date, enc in
            var c = enc.singleValueContainer(); try c.encode(ISO8601.string(date))
        }
        return e
    }
}

// MARK: News & Mail

struct NewsItem: Codable, Identifiable { var id: String; var source: String; var title: String; var url: String; var summary: String?; var language: String?; var publishedAt: Date? }
struct NewsResponse: Codable { var topic: String; var title: String; var items: [NewsItem]; var refreshedAt: Date?; var refreshErrors: [String]; var digest: String? }

struct MailAccount: Codable, Identifiable { var id: String; var provider: String; var email: String; var displayName: String?; var status: String; var lastSyncAt: Date?; var lastError: String? }
struct MailMessage: Codable, Identifiable {
    var id: String; var accountId: String; var threadId: String; var subject: String?; var fromName: String?; var fromEmail: String?
    var toEmails: [String]; var ccEmails: [String]; var snippet: String?; var bodyText: String?; var receivedAt: Date; var isFromMe: Bool; var hasAttachments: Bool; var webLink: String?
    var needsReply: Bool; var replyStatus: String; var aiReason: String?; var aiPriority: Int?; var aiSuggestedAction: String?; var linkedTaskId: String?
}
struct MailSyncResponse: Codable { struct Acc: Codable { var email: String; var fetched: Int; var pending: Int; var errors: [String] }; var accounts: [Acc]; var message: String? }
