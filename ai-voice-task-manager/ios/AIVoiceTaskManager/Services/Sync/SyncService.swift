import Foundation
import Observation
import SwiftData

/// Two-way sync with Supabase via PostgREST. Pull = rows with updated_at > cursor; push = queued ops.
/// Conflict policy: last write wins by updated_at (personal single-user app).
@Observable
final class SyncService {
    private let client: SupabaseClient
    private let container: ModelContainer
    private(set) var isSyncing = false
    private(set) var lastError: String?
    private(set) var lastSyncAt: Date? = UserDefaults.standard.object(forKey: "sync.lastAt") as? Date

    private let decoder = ISO8601.decoder()
    private let encoder = ISO8601.encoder()

    init(client: SupabaseClient, container: ModelContainer) {
        self.client = client
        self.container = container
    }

    private func cursor(_ table: String) -> Date? { UserDefaults.standard.object(forKey: "sync.cursor.\(table)") as? Date }
    private func setCursor(_ table: String, _ d: Date) { UserDefaults.standard.set(d, forKey: "sync.cursor.\(table)") }

    @MainActor
    func syncNow() async {
        guard !isSyncing, await client.isAuthenticated else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            try await push()
            try await pull()
            lastSyncAt = .now
            UserDefaults.standard.set(lastSyncAt, forKey: "sync.lastAt")
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: push

    @MainActor
    private func push() async throws {
        let ctx = container.mainContext
        let ops = try ctx.fetch(FetchDescriptor<PendingSyncOp>(sortBy: [SortDescriptor(\.createdAt)]))
        guard !ops.isEmpty, let userId = await client.userId else { return }
        for op in ops {
            do {
                if op.op == "delete" { try await client.delete(op.table, id: op.recordId) }
                else {
                    // inject user_id (RLS requires it) – payload is a JSON object
                    var obj = (try? JSONSerialization.jsonObject(with: op.payload) as? [String: Any]) ?? [:]
                    obj["user_id"] = userId.uuidString.lowercased()
                    let data = try JSONSerialization.data(withJSONObject: [obj])
                    _ = try await client.upsert(op.table, rows: data)
                }
                ctx.delete(op)
            } catch SupabaseError.offline { throw SupabaseError.offline }
            catch {
                op.attempts += 1
                if op.attempts > 10 { ctx.delete(op) } // poison op: drop and surface
                lastError = "Не удалось отправить \(op.table): \(error.localizedDescription)"
            }
        }
        try ctx.save()
    }

    // MARK: pull

    @MainActor
    private func pull() async throws {
        let ctx = container.mainContext
        try await pullTable("workspaces", WorkspaceDTO.self, ctx) { dto, c in
            let row = try Self.find(Workspace.self, dto.id, c) ?? { let w = Workspace(id: dto.id, name: dto.name, syncState: .synced); c.insert(w); return w }()
            row.name = dto.name; row.sortOrder = dto.sortOrder ?? 0; row.updatedAt = dto.updatedAt ?? .now; row.syncState = SyncState.synced.rawValue
        }
        try await pullTable("projects", ProjectDTO.self, ctx) { dto, c in
            let row = try Self.find(Project.self, dto.id, c) ?? { let p = Project(id: dto.id, workspaceId: dto.workspaceId, name: dto.name, syncState: .synced); c.insert(p); return p }()
            row.workspaceId = dto.workspaceId; row.name = dto.name; row.aliases = dto.aliases ?? []; row.colorHex = dto.colorHex
            row.isArchived = dto.isArchived ?? false; row.sortOrder = dto.sortOrder ?? 0; row.updatedAt = dto.updatedAt ?? .now; row.syncState = SyncState.synced.rawValue
        }
        try await pullTable("areas", AreaDTO.self, ctx) { dto, c in
            let row = try Self.find(Area.self, dto.id, c) ?? { let a = Area(id: dto.id, projectId: dto.projectId, name: dto.name, syncState: .synced); c.insert(a); return a }()
            row.projectId = dto.projectId; row.parentAreaId = dto.parentAreaId; row.name = dto.name; row.aliases = dto.aliases ?? []
            row.sortOrder = dto.sortOrder ?? 0; row.updatedAt = dto.updatedAt ?? .now; row.syncState = SyncState.synced.rawValue
        }
        try await pullTable("organisations", OrganisationDTO.self, ctx) { dto, c in
            let row = try Self.find(Organisation.self, dto.id, c) ?? { let o = Organisation(id: dto.id, name: dto.name, syncState: .synced); c.insert(o); return o }()
            row.name = dto.name; row.aliases = dto.aliases ?? []; row.updatedAt = dto.updatedAt ?? .now; row.syncState = SyncState.synced.rawValue
        }
        try await pullTable("people", PersonDTO.self, ctx) { dto, c in
            let row = try Self.find(Person.self, dto.id, c) ?? { let p = Person(id: dto.id, name: dto.name, syncState: .synced); c.insert(p); return p }()
            row.name = dto.name; row.aliases = dto.aliases ?? []; row.organisationId = dto.organisationId; row.role = dto.role; row.notes = dto.notes
            row.updatedAt = dto.updatedAt ?? .now; row.syncState = SyncState.synced.rawValue
        }
        try await pullTable("status_columns", StatusColumnDTO.self, ctx) { dto, c in
            let kind = StatusKind(rawValue: dto.kind) ?? .custom
            let row = try Self.find(StatusColumn.self, dto.id, c) ?? { let s = StatusColumn(id: dto.id, name: dto.name, kind: kind, sortOrder: dto.sortOrder ?? 0, syncState: .synced); c.insert(s); return s }()
            row.name = dto.name; row.kindRaw = dto.kind; row.sortOrder = dto.sortOrder ?? 0; row.updatedAt = dto.updatedAt ?? .now; row.syncState = SyncState.synced.rawValue
        }
        try await pullTable("voice_entries", VoiceEntryDTO.self, ctx) { dto, c in
            let row = try Self.find(VoiceEntry.self, dto.id, c) ?? { let v = VoiceEntry(id: dto.id, createdAt: dto.createdAt ?? .now, audioFileName: nil, durationSec: dto.durationSec ?? 0); c.insert(v); return v }()
            row.language = dto.language ?? row.language
            row.originalTranscript = dto.originalTranscript ?? row.originalTranscript
            row.cleanTranscript = dto.cleanTranscript ?? row.cleanTranscript
            row.aiSummary = dto.aiSummary ?? row.aiSummary
            if let s = dto.processingStatus, let st = ProcessingStatus(rawValue: s), row.processingStatus != .waitingForProcessing || st == .committed { row.processingStatus = st }
            row.updatedAt = dto.updatedAt ?? .now; row.syncState = SyncState.synced.rawValue
        }
        try await pullTable("tasks", TaskDTO.self, ctx) { dto, c in
            let row = try Self.find(TaskItem.self, dto.id, c) ?? { let t = TaskItem(id: dto.id, title: dto.title, statusId: dto.statusId); c.insert(t); return t }()
            // Local unsynced edits newer than the server copy win.
            if row.syncState != SyncState.synced.rawValue, let remote = dto.updatedAt, row.updatedAt > remote { return }
            Self.apply(dto, to: row)
        }
        try await pullTable("reminders", ReminderDTO.self, ctx) { dto, c in
            let row = try Self.find(ReminderEntry.self, dto.id, c) ?? { let r = ReminderEntry(id: dto.id, taskId: dto.taskId, fireAt: dto.fireAt, syncState: .synced); c.insert(r); return r }()
            row.taskId = dto.taskId; row.fireAt = dto.fireAt; row.repeatRule = dto.repeatRule; row.kind = dto.kind ?? "reminder"; row.deliveredAt = dto.deliveredAt
            row.updatedAt = dto.updatedAt ?? .now; row.syncState = SyncState.synced.rawValue
        }
        try await pullPreferences(ctx)
        try ctx.save()
        NotificationCenter.default.post(name: .syncCompleted, object: nil)
    }

    private func pullTable<D: Decodable>(_ table: String, _ type: D.Type, _ ctx: ModelContext, apply: (D, ModelContext) throws -> Void) async throws {
        var query = [URLQueryItem(name: "select", value: "*"), URLQueryItem(name: "order", value: "updated_at.asc"), URLQueryItem(name: "limit", value: "1000")]
        if let c = cursor(table) { query.append(URLQueryItem(name: "updated_at", value: "gt.\(ISO8601.string(c))")) }
        if table == "tasks" { query[0] = URLQueryItem(name: "select", value: TaskRepository.taskColumns) } // never download vectors
        let data = try await client.select(table, query: query)
        let rows = try decoder.decode([D].self, from: data)
        var newest = cursor(table)
        for dto in rows {
            try apply(dto, ctx)
            if let d = (dto as? HasUpdatedAt)?.updatedAtValue, d > (newest ?? .distantPast) { newest = d }
        }
        if let newest { setCursor(table, newest) }
    }

    private func pullPreferences(_ ctx: ModelContext) async throws {
        let data = try await client.select("preference_profiles", query: [URLQueryItem(name: "select", value: "*")])
        guard let dto = try decoder.decode([PreferenceDTO].self, from: data).first else { return }
        let prefs = try ctx.fetch(FetchDescriptor<PreferenceProfile>()).first ?? { let p = PreferenceProfile(); ctx.insert(p); return p }()
        guard let remote = dto.updatedAt, remote >= prefs.updatedAt else { return }
        prefs.morningTime = dto.morningTime ?? prefs.morningTime; prefs.dayTime = dto.dayTime ?? prefs.dayTime
        prefs.eveningTime = dto.eveningTime ?? prefs.eveningTime; prefs.nightTime = dto.nightTime ?? prefs.nightTime
        prefs.endOfDayTime = dto.endOfDayTime ?? prefs.endOfDayTime
        prefs.defaultPriority = dto.defaultPriority ?? prefs.defaultPriority
        prefs.autoFileThreshold = dto.autoFileThreshold ?? prefs.autoFileThreshold
        prefs.aliases = dto.aliases ?? prefs.aliases; prefs.routingRules = dto.routingRules ?? prefs.routingRules
        prefs.deleteAudioAfterTranscription = dto.deleteAudioAfterTranscription ?? prefs.deleteAudioAfterTranscription
        prefs.privateMode = dto.privateMode ?? prefs.privateMode
        prefs.appleRemindersSyncRaw = dto.appleRemindersSync ?? prefs.appleRemindersSyncRaw
        prefs.briefingTime = dto.briefingTime ?? prefs.briefingTime
        prefs.updatedAt = remote
    }

    func pushPreferences(_ p: PreferenceProfile) async {
        guard let userId = await client.userId else { return }
        let dto = PreferenceDTO(userId: userId, timezone: p.timezone, language: p.language, morningTime: p.morningTime, dayTime: p.dayTime, eveningTime: p.eveningTime, nightTime: p.nightTime,
                                endOfDayTime: p.endOfDayTime, defaultPriority: p.defaultPriority, autoFileThreshold: p.autoFileThreshold, aliases: p.aliases, routingRules: p.routingRules,
                                deleteAudioAfterTranscription: p.deleteAudioAfterTranscription, privateMode: p.privateMode, appleRemindersSync: p.appleRemindersSyncRaw, briefingTime: p.briefingTime, updatedAt: nil)
        if let data = try? encoder.encode([dto]) { _ = try? await client.upsert("preference_profiles", rows: data, onConflict: "user_id") }
    }

    func resetCursors() {
        for t in ["workspaces", "projects", "areas", "organisations", "people", "status_columns", "voice_entries", "tasks", "reminders"] { UserDefaults.standard.removeObject(forKey: "sync.cursor.\(t)") }
    }

    // MARK: helpers

    static func find<T: PersistentModel>(_ type: T.Type, _ id: UUID, _ ctx: ModelContext) throws -> T? where T: HasID {
        var d = FetchDescriptor<T>(predicate: T.predicate(id: id))
        d.fetchLimit = 1
        return try ctx.fetch(d).first
    }

    static func apply(_ dto: TaskDTO, to row: TaskItem) {
        row.kindRaw = dto.kind ?? row.kindRaw; row.title = dto.title; row.taskDescription = dto.description; row.statusId = dto.statusId
        row.priorityRaw = dto.priority ?? row.priorityRaw; row.createdAt = dto.createdAt ?? row.createdAt; row.updatedAt = dto.updatedAt ?? .now
        row.startAt = dto.startAt; row.dueAt = dto.dueAt; row.eventEndAt = dto.eventEndAt; row.completedAt = dto.completedAt; row.reminderAt = dto.reminderAt
        row.followUpAt = dto.followUpAt; row.recurrenceRule = dto.recurrenceRule; row.workspaceId = dto.workspaceId; row.projectId = dto.projectId; row.areaId = dto.areaId
        row.parentTaskId = dto.parentTaskId; row.sourceId = dto.sourceId; row.originalTranscript = dto.originalTranscript; row.cleanTranscript = dto.cleanTranscript
        row.aiConfidence = dto.aiConfidence; row.estimatedDurationMin = dto.estimatedDurationMin; row.isWaiting = dto.isWaiting ?? false
        row.waitingForPersonId = dto.waitingForPersonId; row.waitingSubject = dto.waitingSubject; row.personId = dto.personId; row.organisationId = dto.organisationId
        row.tags = dto.tags ?? []; row.calendarEventId = dto.calendarEventId ?? row.calendarEventId; row.appleReminderId = dto.appleReminderId ?? row.appleReminderId
        row.deletedAt = dto.deletedAt; row.syncState = SyncState.synced.rawValue
    }
}

protocol HasUpdatedAt { var updatedAtValue: Date? { get } }
extension WorkspaceDTO: HasUpdatedAt { var updatedAtValue: Date? { updatedAt } }
extension ProjectDTO: HasUpdatedAt { var updatedAtValue: Date? { updatedAt } }
extension AreaDTO: HasUpdatedAt { var updatedAtValue: Date? { updatedAt } }
extension OrganisationDTO: HasUpdatedAt { var updatedAtValue: Date? { updatedAt } }
extension PersonDTO: HasUpdatedAt { var updatedAtValue: Date? { updatedAt } }
extension StatusColumnDTO: HasUpdatedAt { var updatedAtValue: Date? { updatedAt } }
extension VoiceEntryDTO: HasUpdatedAt { var updatedAtValue: Date? { updatedAt } }
extension TaskDTO: HasUpdatedAt { var updatedAtValue: Date? { updatedAt } }
extension ReminderDTO: HasUpdatedAt { var updatedAtValue: Date? { updatedAt } }

/// Lets the generic finder build a #Predicate per model type.
protocol HasID: PersistentModel { static func predicate(id: UUID) -> Predicate<Self> }
extension Workspace: HasID { static func predicate(id: UUID) -> Predicate<Workspace> { #Predicate { $0.id == id } } }
extension Project: HasID { static func predicate(id: UUID) -> Predicate<Project> { #Predicate { $0.id == id } } }
extension Area: HasID { static func predicate(id: UUID) -> Predicate<Area> { #Predicate { $0.id == id } } }
extension Organisation: HasID { static func predicate(id: UUID) -> Predicate<Organisation> { #Predicate { $0.id == id } } }
extension Person: HasID { static func predicate(id: UUID) -> Predicate<Person> { #Predicate { $0.id == id } } }
extension StatusColumn: HasID { static func predicate(id: UUID) -> Predicate<StatusColumn> { #Predicate { $0.id == id } } }
extension VoiceEntry: HasID { static func predicate(id: UUID) -> Predicate<VoiceEntry> { #Predicate { $0.id == id } } }
extension TaskItem: HasID { static func predicate(id: UUID) -> Predicate<TaskItem> { #Predicate { $0.id == id } } }
extension ReminderEntry: HasID { static func predicate(id: UUID) -> Predicate<ReminderEntry> { #Predicate { $0.id == id } } }

extension Notification.Name { static let syncCompleted = Notification.Name("syncCompleted") }
