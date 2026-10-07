import Foundation
import Observation
import SwiftData

/// Local-first task operations. Every mutation: updates SwiftData, enqueues a sync op, re-plans
/// notifications and (if enabled) mirrors to Apple Calendar / Reminders.
@MainActor
@Observable
final class TaskRepository {
    static let taskColumns = "id,user_id,kind,title,description,status_id,priority,created_at,updated_at,start_at,due_at,event_end_at,completed_at,reminder_at,follow_up_at,recurrence_rule,workspace_id,project_id,area_id,parent_task_id,source_id,original_transcript,clean_transcript,ai_confidence,estimated_duration_min,is_waiting,waiting_for_person_id,waiting_subject,person_id,organisation_id,tags,calendar_event_id,apple_reminder_id,deleted_at"

    let context: ModelContext
    let notifications: NotificationService
    let calendar: CalendarService
    let remindersService: RemindersService
    let client: SupabaseClient
    private let encoder = ISO8601.encoder()

    init(context: ModelContext, notifications: NotificationService, calendar: CalendarService, remindersService: RemindersService, client: SupabaseClient) {
        self.context = context; self.notifications = notifications; self.calendar = calendar; self.remindersService = remindersService; self.client = client
    }

    // MARK: lookups

    var prefs: PreferenceProfile {
        if let p = try? context.fetch(FetchDescriptor<PreferenceProfile>()).first { return p }
        let p = PreferenceProfile(); context.insert(p); return p
    }
    func statuses() -> [StatusColumn] { (try? context.fetch(FetchDescriptor<StatusColumn>(sortBy: [SortDescriptor(\.sortOrder)]))) ?? [] }
    func status(kind: StatusKind) -> StatusColumn? { statuses().first { $0.kind == kind } }
    func task(_ id: UUID) -> TaskItem? { try? SyncService.find(TaskItem.self, id, context) }
    func project(_ id: UUID?) -> Project? { id.flatMap { try? SyncService.find(Project.self, $0, context) } }
    func area(_ id: UUID?) -> Area? { id.flatMap { try? SyncService.find(Area.self, $0, context) } }
    func person(_ id: UUID?) -> Person? { id.flatMap { try? SyncService.find(Person.self, $0, context) } }
    func workspace(_ id: UUID?) -> Workspace? { id.flatMap { try? SyncService.find(Workspace.self, $0, context) } }
    func reminders(for taskId: UUID) -> [ReminderEntry] {
        (try? context.fetch(FetchDescriptor<ReminderEntry>(predicate: #Predicate { $0.taskId == taskId }))) ?? []
    }
    func categoryPath(_ t: TaskItem) -> String { [project(t.projectId)?.name, area(t.areaId)?.name].compactMap { $0 }.joined(separator: " → ") }

    func openTasks() -> [TaskItem] {
        let all = (try? context.fetch(FetchDescriptor<TaskItem>(predicate: #Predicate { $0.deletedAt == nil && $0.completedAt == nil }, sortBy: [SortDescriptor(\.dueAt)]))) ?? []
        return all
    }
    func allTasks() -> [TaskItem] { (try? context.fetch(FetchDescriptor<TaskItem>(predicate: #Predicate { $0.deletedAt == nil }, sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]))) ?? [] }

    /// Ensures default status columns exist locally even before the first sync (offline first launch).
    func ensureDefaults() {
        if statuses().isEmpty {
            let defaults: [(String, StatusKind)] = [("Inbox", .inbox), ("To Do", .todo), ("В работе", .inProgress), ("Жду ответ", .waiting), ("Завершено", .done)]
            for (i, (name, kind)) in defaults.enumerated() {
                let col = StatusColumn(name: name, kind: kind, sortOrder: i)
                context.insert(col); enqueue("status_columns", col.id, StatusColumnDTO(id: col.id, userId: nil, name: name, kind: kind.rawValue, sortOrder: i, updatedAt: nil))
            }
        }
        if ((try? context.fetch(FetchDescriptor<Workspace>()))?.isEmpty ?? true) {
            for (i, name) in ["Работа", "Личное"].enumerated() {
                let w = Workspace(name: name, sortOrder: i); context.insert(w)
                enqueue("workspaces", w.id, WorkspaceDTO(id: w.id, userId: nil, name: name, sortOrder: i, updatedAt: nil))
            }
        }
        _ = prefs
        try? context.save()
    }

    // MARK: mutations

    @discardableResult
    func create(title: String, kind: TaskKind = .task, priority: Priority? = nil, dueAt: Date? = nil, reminderAt: Date? = nil, projectId: UUID? = nil, areaId: UUID? = nil, description: String? = nil) -> TaskItem {
        let p = priority ?? Priority(rawValue: prefs.defaultPriority) ?? .p3
        let st = status(kind: kind == .waiting ? .waiting : .todo)
        let t = TaskItem(kind: kind, title: title, statusId: st?.id, priority: p, dueAt: dueAt, reminderAt: reminderAt, projectId: projectId, areaId: areaId, workspaceId: project(projectId)?.workspaceId)
        t.taskDescription = description
        t.isWaiting = kind == .waiting
        context.insert(t)
        persist(t)
        return t
    }

    func save(_ t: TaskItem) { t.updatedAt = .now; persist(t) }

    func complete(_ t: TaskItem, done: Bool = true) {
        t.completedAt = done ? .now : nil
        t.statusId = done ? status(kind: .done)?.id : status(kind: t.isWaiting ? .waiting : .todo)?.id
        if done { t.isWaiting = false }
        save(t)
    }

    func move(_ t: TaskItem, to column: StatusColumn) {
        t.statusId = column.id
        switch column.kind {
        case .done: t.completedAt = .now; t.isWaiting = false
        case .waiting: t.isWaiting = true; t.completedAt = nil
        default: t.completedAt = nil
        }
        save(t)
    }

    /// Reclassify + record a correction so the parser learns (spec §7).
    func reclassify(_ t: TaskItem, projectId: UUID?, areaId: UUID?) {
        guard t.projectId != projectId || t.areaId != areaId else { return }
        let old = (t.projectId, t.areaId)
        t.projectId = projectId; t.areaId = areaId; t.workspaceId = project(projectId)?.workspaceId
        save(t)
        if old.0 != nil || old.1 != nil, let pid = projectId {
            Task {
                var params: [String: Any] = ["p_task_id": t.id.uuidString.lowercased(), "p_to_project_id": pid.uuidString.lowercased()]
                params["p_to_area_id"] = areaId?.uuidString.lowercased() ?? NSNull()
                _ = try? await client.rpc("record_correction", params: params)
            }
        }
    }

    func reschedule(_ tasks: [TaskItem], to date: Date, keepTime: Bool) -> ActionBatchRecord {
        var affected: [UUID] = []
        var before: [UUID: Date?] = [:]
        for t in tasks {
            before[t.id] = t.dueAt
            var newDue = date
            if keepTime, let old = t.dueAt {
                let c = Calendar.current.dateComponents([.hour, .minute], from: old)
                newDue = Calendar.current.date(bySettingHour: c.hour ?? 18, minute: c.minute ?? 0, second: 0, of: date) ?? date
            }
            t.dueAt = newDue
            save(t)
            affected.append(t.id)
        }
        let batch = ActionBatchRecord(id: UUID(), summary: "\(tasks.count) задач перенесено на \(DateService.absoluteLabel(date))", affectedTaskIds: affected)
        context.insert(batch)
        UndoService.shared.remember(local: batch, restore: { [weak self] in
            for t in tasks { t.dueAt = before[t.id] ?? nil; self?.save(t) }
        })
        try? context.save()
        return batch
    }

    func softDelete(_ t: TaskItem) {
        t.deletedAt = .now
        save(t)
        notifications.cancel(for: t.id)
        if let id = t.calendarEventId { calendar.removeEvent(id: id) }
        if let id = t.appleReminderId { remindersService.remove(id: id) }
    }

    func snooze(_ t: TaskItem, by interval: TimeInterval = 3600) {
        t.reminderAt = Date().addingTimeInterval(interval)
        let r = ReminderEntry(taskId: t.id, fireAt: t.reminderAt!)
        context.insert(r)
        enqueue("reminders", r.id, ReminderDTO(id: r.id, userId: nil, taskId: t.id, fireAt: r.fireAt, repeatRule: nil, kind: "reminder", deliveredAt: nil, updatedAt: nil))
        save(t)
    }

    func addReminder(_ t: TaskItem, at: Date, rule: String? = nil) {
        let r = ReminderEntry(taskId: t.id, fireAt: at, repeatRule: rule)
        context.insert(r)
        enqueue("reminders", r.id, ReminderDTO(id: r.id, userId: nil, taskId: t.id, fireAt: at, repeatRule: rule, kind: "reminder", deliveredAt: nil, updatedAt: nil))
        if t.reminderAt == nil || at < t.reminderAt! { t.reminderAt = at }
        save(t)
    }

    func linkToCalendar(_ t: TaskItem) {
        guard calendar.hasAccess else { return }
        let notes = [categoryPath(t), t.taskDescription].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n")
        if let id = try? calendar.upsertEvent(for: t, notes: notes) { t.calendarEventId = id; save(t) }
    }

    // MARK: structure

    @discardableResult
    func createProject(name: String, workspaceId: UUID) -> Project {
        let p = Project(workspaceId: workspaceId, name: name); context.insert(p)
        enqueue("projects", p.id, ProjectDTO(id: p.id, userId: nil, workspaceId: workspaceId, name: name, aliases: [], colorHex: nil, isArchived: false, sortOrder: 0, updatedAt: nil))
        try? context.save(); return p
    }
    @discardableResult
    func createArea(name: String, projectId: UUID, parentAreaId: UUID? = nil) -> Area {
        let a = Area(projectId: projectId, parentAreaId: parentAreaId, name: name); context.insert(a)
        enqueue("areas", a.id, AreaDTO(id: a.id, userId: nil, projectId: projectId, parentAreaId: parentAreaId, name: name, aliases: [], sortOrder: 0, updatedAt: nil))
        try? context.save(); return a
    }
    @discardableResult
    func createStatus(name: String) -> StatusColumn {
        let cols = statuses()
        let done = cols.first { $0.kind == .done }
        let order = (done?.sortOrder ?? cols.count)
        if let done { done.sortOrder = order + 1; enqueue("status_columns", done.id, StatusColumnDTO(id: done.id, userId: nil, name: done.name, kind: done.kindRaw, sortOrder: done.sortOrder, updatedAt: nil)) }
        let c = StatusColumn(name: name, kind: .custom, sortOrder: order); context.insert(c)
        enqueue("status_columns", c.id, StatusColumnDTO(id: c.id, userId: nil, name: name, kind: "custom", sortOrder: order, updatedAt: nil))
        try? context.save(); return c
    }
    func renameStatus(_ c: StatusColumn, to name: String) {
        c.name = name; enqueue("status_columns", c.id, StatusColumnDTO(id: c.id, userId: nil, name: name, kind: c.kindRaw, sortOrder: c.sortOrder, updatedAt: nil)); try? context.save()
    }
    func deleteStatus(_ c: StatusColumn) {
        guard c.kind == .custom, let todo = status(kind: .todo) else { return }
        for t in allTasks() where t.statusId == c.id { t.statusId = todo.id; save(t) }
        context.delete(c)
        let op = PendingSyncOp(table: "status_columns", recordId: c.id, op: "delete", payload: Data()); context.insert(op)
        try? context.save()
    }
    @discardableResult
    func createPerson(name: String, role: String?, organisationId: UUID?) -> Person {
        let p = Person(name: name, organisationId: organisationId, role: role); context.insert(p)
        enqueue("people", p.id, PersonDTO(id: p.id, userId: nil, name: name, aliases: [], organisationId: organisationId, role: role, notes: nil, updatedAt: nil))
        try? context.save(); return p
    }

    // MARK: voice entries

    func upsertVoiceEntry(_ v: VoiceEntry) {
        v.updatedAt = .now
        let dto = VoiceEntryDTO(id: v.id, userId: nil, createdAt: v.createdAt, updatedAt: nil, audioPath: nil, durationSec: v.durationSec,
                                language: v.language, originalTranscript: prefs.privateMode ? nil : v.originalTranscript, cleanTranscript: prefs.privateMode ? nil : v.cleanTranscript,
                                processingStatus: v.processingStatusRaw, aiSummary: prefs.privateMode ? nil : v.aiSummary)
        enqueue("voice_entries", v.id, dto)
        try? context.save()
    }

    /// Server returned the committed rows – mirror them locally and arm notifications.
    func ingest(serverTasks: [TaskDTO]) {
        for dto in serverTasks {
            let row = (try? SyncService.find(TaskItem.self, dto.id, context)) ?? { let t = TaskItem(id: dto.id, title: dto.title, statusId: dto.statusId); context.insert(t); return t }()
            SyncService.apply(dto, to: row)
            if let at = row.reminderAt, reminders(for: row.id).isEmpty { context.insert(ReminderEntry(taskId: row.id, fireAt: at, repeatRule: row.recurrenceRule, syncState: .synced)) }
            if let at = row.followUpAt { context.insert(ReminderEntry(taskId: row.id, fireAt: at, kind: "follow_up", syncState: .synced)) }
            afterChange(row)
        }
        try? context.save()
    }

    func rearmAllNotifications() { for t in openTasks() { afterChange(t) } }

    // MARK: internals

    private func persist(_ t: TaskItem) {
        t.syncState = SyncState.pendingUpsert.rawValue
        enqueue("tasks", t.id, dto(t))
        afterChange(t)
        try? context.save()
    }

    private func afterChange(_ t: TaskItem) {
        notifications.schedule(for: t, reminders: reminders(for: t.id), project: project(t.projectId)?.name)
        if t.kind == .event, t.calendarEventId != nil || calendar.hasAccess { linkToCalendarIfOwned(t) }
        let mode = prefs.appleRemindersSync
        if mode != .off, remindersService.hasAccess {
            if remindersService.shouldMirror(t, mode: mode) || t.appleReminderId != nil, let id = try? remindersService.upsert(t), t.appleReminderId != id {
                t.appleReminderId = id; enqueue("tasks", t.id, dto(t))
            }
        }
    }

    private func linkToCalendarIfOwned(_ t: TaskItem) {
        guard t.kind == .event, calendar.hasAccess, !t.isDone, t.deletedAt == nil else { return }
        if let id = try? calendar.upsertEvent(for: t, notes: categoryPath(t)), t.calendarEventId != id { t.calendarEventId = id; enqueue("tasks", t.id, dto(t)) }
    }

    private func dto(_ t: TaskItem) -> TaskDTO {
        TaskDTO(id: t.id, userId: nil, kind: t.kindRaw, title: t.title, description: t.taskDescription, statusId: t.statusId, priority: t.priorityRaw, createdAt: t.createdAt, updatedAt: t.updatedAt,
                startAt: t.startAt, dueAt: t.dueAt, eventEndAt: t.eventEndAt, completedAt: t.completedAt, reminderAt: t.reminderAt, followUpAt: t.followUpAt, recurrenceRule: t.recurrenceRule,
                workspaceId: t.workspaceId, projectId: t.projectId, areaId: t.areaId, parentTaskId: t.parentTaskId, sourceId: t.sourceId, originalTranscript: t.originalTranscript,
                cleanTranscript: t.cleanTranscript, aiConfidence: t.aiConfidence, estimatedDurationMin: t.estimatedDurationMin, isWaiting: t.isWaiting, waitingForPersonId: t.waitingForPersonId,
                waitingSubject: t.waitingSubject, personId: t.personId, organisationId: t.organisationId, tags: t.tags, calendarEventId: t.calendarEventId, appleReminderId: t.appleReminderId, deletedAt: t.deletedAt)
    }

    private func enqueue<T: Encodable>(_ table: String, _ id: UUID, _ payload: T) {
        guard let data = try? encoder.encode(payload) else { return }
        // Coalesce: keep a single pending upsert per record.
        if let existing = try? context.fetch(FetchDescriptor<PendingSyncOp>(predicate: #Predicate { $0.recordId == id && $0.op == "upsert" })) { existing.forEach { context.delete($0) } }
        context.insert(PendingSyncOp(table: table, recordId: id, op: "upsert", payload: data))
    }
}
