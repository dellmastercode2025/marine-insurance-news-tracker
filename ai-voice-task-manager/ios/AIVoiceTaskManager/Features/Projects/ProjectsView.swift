import SwiftData
import SwiftUI

/// Workspace → Project → Area tree (spec §24) with counts and management.
struct ProjectsView: View {
    @Environment(AppEnvironment.self) private var env
    @Query(sort: \Workspace.sortOrder) private var workspaces: [Workspace]
    @Query(sort: \Project.sortOrder) private var projects: [Project]
    @Query(sort: \Area.sortOrder) private var areas: [Area]
    @Query(filter: #Predicate<TaskItem> { $0.deletedAt == nil && $0.completedAt == nil }) private var open: [TaskItem]
    @State private var newProject: (workspace: Workspace, name: String)?
    @State private var showPeople = false
    @State private var showVoiceLog = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(workspaces) { ws in
                    Section {
                        ForEach(projects.filter { $0.workspaceId == ws.id && !$0.isArchived }) { p in
                            NavigationLink { ProjectDetailView(project: p) } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack { Text(p.name).font(.body.weight(.medium)); Spacer(); Text("\(open.filter { $0.projectId == p.id }.count)").foregroundStyle(.secondary) }
                                    let names = areas.filter { $0.projectId == p.id && $0.parentAreaId == nil }.map(\.name)
                                    if !names.isEmpty { Text(names.map { "→ \($0)" }.joined(separator: "   ")).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                                }
                            }
                        }
                        Button { newProject = (ws, "") } label: { Label("Новый проект", systemImage: "plus") }.font(.subheadline)
                    } header: { Text(ws.name) }
                }
                Section {
                    Button { showPeople = true } label: { Label("Люди и организации", systemImage: "person.2") }
                    Button { showVoiceLog = true } label: { Label("Голосовые записи", systemImage: "waveform") }
                }
            }
            .navigationTitle("Проекты")
            .sheet(isPresented: $showPeople) { NavigationStack { PeopleView() } }
            .sheet(isPresented: $showVoiceLog) { NavigationStack { VoiceLogView() } }
            .alert("Новый проект", isPresented: Binding(get: { newProject != nil }, set: { if !$0 { newProject = nil } })) {
                TextField("Название", text: Binding(get: { newProject?.name ?? "" }, set: { newProject?.name = $0 }))
                Button("Создать") { if let np = newProject, !np.name.isEmpty { env.repo.createProject(name: np.name, workspaceId: np.workspace.id) }; newProject = nil }
                Button("Отмена", role: .cancel) { newProject = nil }
            }
        }
    }
}

struct ProjectDetailView: View {
    @Environment(AppEnvironment.self) private var env
    let project: Project
    @Query(sort: \Area.sortOrder) private var allAreas: [Area]
    @Query(filter: #Predicate<TaskItem> { $0.deletedAt == nil }, sort: [SortDescriptor(\TaskItem.priorityRaw), SortDescriptor(\TaskItem.dueAt)]) private var tasks: [TaskItem]
    @State private var newArea = ""
    @State private var showDone = false
    @State private var aliases = ""

    private var areas: [Area] { allAreas.filter { $0.projectId == project.id } }
    private var projectTasks: [TaskItem] { tasks.filter { $0.projectId == project.id && (showDone || !$0.isDone) } }

    var body: some View {
        List {
            Section {
                TextField("Синонимы через запятую (КМТФ, KMTF)", text: $aliases)
                    .onAppear { aliases = project.aliases.joined(separator: ", ") }
                    .onSubmit { project.aliases = aliases.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }; project.updatedAt = .now
                        env.repo.context.insert(PendingSyncOp(table: "projects", recordId: project.id, op: "upsert", payload: (try? ISO8601.encoder().encode(ProjectDTO(id: project.id, userId: nil, workspaceId: project.workspaceId, name: project.name, aliases: project.aliases, colorHex: project.colorHex, isArchived: project.isArchived, sortOrder: project.sortOrder, updatedAt: nil))) ?? Data()))
                        try? env.repo.context.save() }
                Toggle("Показывать завершённые", isOn: $showDone)
            }
            let noArea = projectTasks.filter { $0.areaId == nil }
            if !noArea.isEmpty { Section("Без направления") { ForEach(noArea) { t in NavigationLink { TaskDetailView(task: t) } label: { TaskRowView(task: t, showProject: false) } } } }
            ForEach(areas.filter { $0.parentAreaId == nil }) { area in
                let subIds = Set(areas.filter { $0.parentAreaId == area.id }.map(\.id))
                let items = projectTasks.filter { $0.areaId == area.id || ($0.areaId.map { subIds.contains($0) } ?? false) }
                Section("\(area.name) (\(items.count))") {
                    ForEach(items) { t in NavigationLink { TaskDetailView(task: t) } label: { TaskRowView(task: t, showProject: false) } }
                }
            }
            Section("Добавить направление") {
                HStack { TextField("Например: War Risk", text: $newArea); Button("Добавить") { env.repo.createArea(name: newArea, projectId: project.id); newArea = "" }.disabled(newArea.isEmpty) }
            }
        }
        .navigationTitle(project.name)
    }
}

struct VoiceLogView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \VoiceEntry.createdAt, order: .reverse) private var entries: [VoiceEntry]

    var body: some View {
        List(entries) { e in
            VStack(alignment: .leading, spacing: 4) {
                HStack { Text(e.createdAt.formatted(date: .abbreviated, time: .shortened)).font(.subheadline.bold()); Spacer(); Text(e.processingStatus.label).font(.caption).foregroundStyle(.secondary) }
                if let s = e.aiSummary { Text(s).font(.subheadline) }
                if let t = e.cleanTranscript ?? e.liveTranscript { Text(t).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                if e.audioFileName != nil { Label("Аудио сохранено", systemImage: "waveform").font(.caption2) }
                if let err = e.lastError { Text(err).font(.caption2).foregroundStyle(.red) }
                if e.processingStatus == .parsed || e.processingStatus == .failed || e.processingStatus == .waitingForProcessing {
                    Button("Продолжить обработку") { env.voice.resumeReview(e); dismiss(); env.showRecorder = true }.font(.caption)
                }
            }
            .swipeActions { Button(role: .destructive) { env.voice.deleteAudio(e); e.processingStatus = .discarded; env.repo.upsertVoiceEntry(e) } label: { Label("Удалить", systemImage: "trash") } }
        }
        .navigationTitle("Голосовые записи")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
    }
}
