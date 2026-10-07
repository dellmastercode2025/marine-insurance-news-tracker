import Foundation
import SwiftData

// Local SwiftData mirror of the Postgres schema. Relations are expressed through ids (same UUIDs as
// the server) so that sync is a plain row upsert and offline creation needs no server round trip.

@Model final class Workspace {
    @Attribute(.unique) var id: UUID
    var name: String
    var sortOrder: Int
    var updatedAt: Date
    var syncState: String

    init(id: UUID = UUID(), name: String, sortOrder: Int = 0, updatedAt: Date = .now, syncState: SyncState = .pendingUpsert) {
        self.id = id; self.name = name; self.sortOrder = sortOrder; self.updatedAt = updatedAt; self.syncState = syncState.rawValue
    }
}

@Model final class Project {
    @Attribute(.unique) var id: UUID
    var workspaceId: UUID
    var name: String
    var aliases: [String]
    var colorHex: String?
    var isArchived: Bool
    var sortOrder: Int
    var updatedAt: Date
    var syncState: String

    init(id: UUID = UUID(), workspaceId: UUID, name: String, aliases: [String] = [], colorHex: String? = nil, isArchived: Bool = false, sortOrder: Int = 0, updatedAt: Date = .now, syncState: SyncState = .pendingUpsert) {
        self.id = id; self.workspaceId = workspaceId; self.name = name; self.aliases = aliases; self.colorHex = colorHex
        self.isArchived = isArchived; self.sortOrder = sortOrder; self.updatedAt = updatedAt; self.syncState = syncState.rawValue
    }
}

@Model final class Area {
    @Attribute(.unique) var id: UUID
    var projectId: UUID
    var parentAreaId: UUID?
    var name: String
    var aliases: [String]
    var sortOrder: Int
    var updatedAt: Date
    var syncState: String

    init(id: UUID = UUID(), projectId: UUID, parentAreaId: UUID? = nil, name: String, aliases: [String] = [], sortOrder: Int = 0, updatedAt: Date = .now, syncState: SyncState = .pendingUpsert) {
        self.id = id; self.projectId = projectId; self.parentAreaId = parentAreaId; self.name = name; self.aliases = aliases
        self.sortOrder = sortOrder; self.updatedAt = updatedAt; self.syncState = syncState.rawValue
    }
}

@Model final class Organisation {
    @Attribute(.unique) var id: UUID
    var name: String
    var aliases: [String]
    var updatedAt: Date
    var syncState: String
    init(id: UUID = UUID(), name: String, aliases: [String] = [], updatedAt: Date = .now, syncState: SyncState = .pendingUpsert) {
        self.id = id; self.name = name; self.aliases = aliases; self.updatedAt = updatedAt; self.syncState = syncState.rawValue
    }
}

@Model final class Person {
    @Attribute(.unique) var id: UUID
    var name: String
    var aliases: [String]
    var organisationId: UUID?
    var role: String?
    var notes: String?
    var updatedAt: Date
    var syncState: String
    init(id: UUID = UUID(), name: String, aliases: [String] = [], organisationId: UUID? = nil, role: String? = nil, notes: String? = nil, updatedAt: Date = .now, syncState: SyncState = .pendingUpsert) {
        self.id = id; self.name = name; self.aliases = aliases; self.organisationId = organisationId; self.role = role; self.notes = notes
        self.updatedAt = updatedAt; self.syncState = syncState.rawValue
    }
}

@Model final class StatusColumn {
    @Attribute(.unique) var id: UUID
    var name: String
    var kindRaw: String
    var sortOrder: Int
    var updatedAt: Date
    var syncState: String
    var kind: StatusKind { StatusKind(rawValue: kindRaw) ?? .custom }
    init(id: UUID = UUID(), name: String, kind: StatusKind, sortOrder: Int, updatedAt: Date = .now, syncState: SyncState = .pendingUpsert) {
        self.id = id; self.name = name; self.kindRaw = kind.rawValue; self.sortOrder = sortOrder; self.updatedAt = updatedAt; self.syncState = syncState.rawValue
    }
}

@Model final class VoiceEntry {
    @Attribute(.unique) var id: UUID
    var createdAt: Date
    var updatedAt: Date
    var audioFileName: String?       // local file in Application Support/audio; nil once deleted
    var durationSec: Double
    var language: String?
    var originalTranscript: String?
    var cleanTranscript: String?
    var liveTranscript: String?      // on-device realtime draft
    var processingStatusRaw: String
    var aiSummary: String?
    var extractionJSON: Data?        // ParseResponse proposal, kept until committed
    var lastError: String?
    var syncState: String

    var processingStatus: ProcessingStatus {
        get { ProcessingStatus(rawValue: processingStatusRaw) ?? .waitingForProcessing }
        set { processingStatusRaw = newValue.rawValue }
    }

    init(id: UUID = UUID(), createdAt: Date = .now, audioFileName: String?, durationSec: Double, liveTranscript: String? = nil) {
        self.id = id; self.createdAt = createdAt; self.updatedAt = createdAt; self.audioFileName = audioFileName; self.durationSec = durationSec
        self.liveTranscript = liveTranscript; self.processingStatusRaw = ProcessingStatus.waitingForProcessing.rawValue; self.syncState = SyncState.pendingUpsert.rawValue
    }
}

@Model final class TaskItem {
    @Attribute(.unique) var id: UUID
    var kindRaw: String
    var title: String
    var taskDescription: String?
    var statusId: UUID?
    var priorityRaw: Int
    var createdAt: Date
    var updatedAt: Date
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
    var isWaiting: Bool
    var waitingForPersonId: UUID?
    var waitingSubject: String?
    var personId: UUID?
    var organisationId: UUID?
    var tags: [String]
    var calendarEventId: String?
    var appleReminderId: String?
    var deletedAt: Date?
    var syncState: String

    var kind: TaskKind { get { TaskKind(rawValue: kindRaw) ?? .task } set { kindRaw = newValue.rawValue } }
    var priority: Priority { get { Priority(rawValue: priorityRaw) ?? .p3 } set { priorityRaw = newValue.rawValue } }
    var isDone: Bool { completedAt != nil }
    var isOverdue: Bool { !isDone && (dueAt.map { $0 < .now } ?? false) }

    init(id: UUID = UUID(), kind: TaskKind = .task, title: String, statusId: UUID?, priority: Priority = .p3, dueAt: Date? = nil, reminderAt: Date? = nil, projectId: UUID? = nil, areaId: UUID? = nil, workspaceId: UUID? = nil) {
        self.id = id; self.kindRaw = kind.rawValue; self.title = title; self.statusId = statusId; self.priorityRaw = priority.rawValue
        self.createdAt = .now; self.updatedAt = .now; self.dueAt = dueAt; self.reminderAt = reminderAt
        self.projectId = projectId; self.areaId = areaId; self.workspaceId = workspaceId
        self.isWaiting = false; self.tags = []; self.syncState = SyncState.pendingUpsert.rawValue
    }
}

@Model final class ReminderEntry {
    @Attribute(.unique) var id: UUID
    var taskId: UUID
    var fireAt: Date
    var repeatRule: String?
    var kind: String
    var deliveredAt: Date?
    var updatedAt: Date
    var syncState: String
    init(id: UUID = UUID(), taskId: UUID, fireAt: Date, repeatRule: String? = nil, kind: String = "reminder", updatedAt: Date = .now, syncState: SyncState = .pendingUpsert) {
        self.id = id; self.taskId = taskId; self.fireAt = fireAt; self.repeatRule = repeatRule; self.kind = kind; self.updatedAt = updatedAt; self.syncState = syncState.rawValue
    }
}

@Model final class ChatMessage {
    @Attribute(.unique) var id: UUID
    var conversationId: UUID
    var role: String // user | assistant
    var content: String
    var createdAt: Date
    var pendingActionsJSON: Data?
    var batchId: UUID?
    init(conversationId: UUID, role: String, content: String, pendingActionsJSON: Data? = nil, batchId: UUID? = nil) {
        self.id = UUID(); self.conversationId = conversationId; self.role = role; self.content = content; self.createdAt = .now
        self.pendingActionsJSON = pendingActionsJSON; self.batchId = batchId
    }
}

@Model final class PendingSyncOp {
    @Attribute(.unique) var id: UUID
    var table: String
    var recordId: UUID
    var op: String // upsert | delete
    var payload: Data
    var createdAt: Date
    var attempts: Int
    init(table: String, recordId: UUID, op: String, payload: Data) {
        self.id = UUID(); self.table = table; self.recordId = recordId; self.op = op; self.payload = payload; self.createdAt = .now; self.attempts = 0
    }
}

@Model final class ActionBatchRecord {
    @Attribute(.unique) var id: UUID
    var summary: String
    var createdAt: Date
    var undoneAt: Date?
    var affectedTaskIds: [UUID]
    init(id: UUID, summary: String, affectedTaskIds: [UUID]) {
        self.id = id; self.summary = summary; self.createdAt = .now; self.affectedTaskIds = affectedTaskIds
    }
}

@Model final class PreferenceProfile {
    @Attribute(.unique) var key: String = "default"
    var timezone: String
    var language: String
    var morningTime: String
    var dayTime: String
    var eveningTime: String
    var nightTime: String
    var endOfDayTime: String
    var defaultPriority: Int
    var autoFileThreshold: Double
    var aliases: [String: String]
    var routingRules: [String: String]
    var deleteAudioAfterTranscription: Bool
    var privateMode: Bool
    var appleRemindersSyncRaw: String
    var briefingTime: String
    var faceIDLock: Bool
    var updatedAt: Date

    var appleRemindersSync: AppleRemindersSync {
        get { AppleRemindersSync(rawValue: appleRemindersSyncRaw) ?? .off }
        set { appleRemindersSyncRaw = newValue.rawValue }
    }

    init() {
        timezone = TimeZone.current.identifier
        language = Locale.current.language.languageCode?.identifier ?? "ru"
        morningTime = "09:00"; dayTime = "14:00"; eveningTime = "19:00"; nightTime = "22:00"; endOfDayTime = "18:00"
        defaultPriority = 3; autoFileThreshold = 0.85
        aliases = [:]; routingRules = [:]
        deleteAudioAfterTranscription = true; privateMode = false
        appleRemindersSyncRaw = AppleRemindersSync.off.rawValue
        briefingTime = "08:00"; faceIDLock = false
        updatedAt = .now
    }
}

enum ModelSchemaV1 {
    static let models: [any PersistentModel.Type] = [
        Workspace.self, Project.self, Area.self, Organisation.self, Person.self, StatusColumn.self,
        VoiceEntry.self, TaskItem.self, ReminderEntry.self, ChatMessage.self, PendingSyncOp.self,
        ActionBatchRecord.self, PreferenceProfile.self,
    ]
}
