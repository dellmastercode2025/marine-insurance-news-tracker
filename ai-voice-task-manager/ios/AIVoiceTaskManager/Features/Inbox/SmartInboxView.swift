import SwiftData
import SwiftUI

/// Items that could not be filed automatically (spec §18) + unprocessed voice entries.
struct SmartInboxView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<TaskItem> { $0.deletedAt == nil && $0.completedAt == nil }, sort: \TaskItem.createdAt, order: .reverse) private var open: [TaskItem]
    @Query(sort: \VoiceEntry.createdAt, order: .reverse) private var entries: [VoiceEntry]
    @Query(sort: \Project.name) private var projects: [Project]
    @Query(sort: \Area.name) private var areas: [Area]

    private var inboxTasks: [TaskItem] { let id = env.repo.status(kind: .inbox)?.id; return open.filter { $0.statusId == id || $0.projectId == nil } }
    private var pendingEntries: [VoiceEntry] { entries.filter { [.waitingForProcessing, .parsed, .failed].contains($0.processingStatus) } }

    var body: some View {
        List {
            if !pendingEntries.isEmpty {
                Section("Записи, ожидающие обработки") {
                    ForEach(pendingEntries) { e in
                        Button { env.voice.resumeReview(e); dismiss(); env.showRecorder = true } label: {
                            VStack(alignment: .leading) {
                                Text(e.createdAt.formatted(date: .abbreviated, time: .shortened)).font(.subheadline)
                                Text(e.aiSummary ?? e.liveTranscript ?? e.processingStatus.label).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                    }
                }
            }
            Section("Задачи без категории") {
                if inboxTasks.isEmpty { Text("Всё разложено по проектам").foregroundStyle(.secondary) }
                ForEach(inboxTasks) { t in
                    VStack(alignment: .leading, spacing: 8) {
                        NavigationLink { TaskDetailView(task: t) } label: { TaskRowView(task: t) }
                        Text("Куда отнести?").font(.caption).foregroundStyle(.orange)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(projects.filter { !$0.isArchived }) { p in
                                    Menu(p.name) {
                                        Button("Без направления") { file(t, p.id, nil) }
                                        ForEach(areas.filter { $0.projectId == p.id }) { a in Button(a.name) { file(t, p.id, a.id) } }
                                    }.buttonStyle(.bordered).font(.caption)
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Smart Inbox")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
    }

    private func file(_ t: TaskItem, _ pid: UUID, _ aid: UUID?) {
        env.repo.reclassify(t, projectId: pid, areaId: aid)
        if let todo = env.repo.status(kind: .todo), t.statusId == env.repo.status(kind: .inbox)?.id { env.repo.move(t, to: todo) }
    }
}
