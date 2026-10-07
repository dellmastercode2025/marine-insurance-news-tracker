import SwiftData
import SwiftUI
import UniformTypeIdentifiers

/// Kanban with user-defined columns and drag & drop (spec §8).
struct BoardView: View {
    @Environment(AppEnvironment.self) private var env
    @Query(sort: \StatusColumn.sortOrder) private var columns: [StatusColumn]
    @Query(filter: #Predicate<TaskItem> { $0.deletedAt == nil }, sort: [SortDescriptor(\TaskItem.priorityRaw), SortDescriptor(\TaskItem.dueAt)]) private var tasks: [TaskItem]
    @State private var projectFilter: UUID?
    @State private var showColumns = false
    @Query(sort: \Project.sortOrder) private var projects: [Project]

    var body: some View {
        NavigationStack {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(columns) { column in
                        KanbanColumn(column: column, tasks: tasks.filter { $0.statusId == column.id && (projectFilter == nil || $0.projectId == projectFilter) && ($0.completedAt == nil || column.kind == .done) })
                    }
                }
                .padding()
                .padding(.bottom, 80)
            }
            .navigationTitle("Доска")
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Menu {
                        Button("Все проекты") { projectFilter = nil }
                        ForEach(projects) { p in Button(p.name) { projectFilter = p.id } }
                    } label: { Label(projectFilter.flatMap { id in projects.first { $0.id == id }?.name } ?? "Все проекты", systemImage: "line.3.horizontal.decrease.circle") }
                    Button { showColumns = true } label: { Image(systemName: "rectangle.split.3x1") }
                }
            }
            .sheet(isPresented: $showColumns) { NavigationStack { ColumnsEditorView() } }
        }
    }
}

struct KanbanColumn: View {
    @Environment(AppEnvironment.self) private var env
    let column: StatusColumn
    let tasks: [TaskItem]
    @State private var targeted = false
    @State private var quickTitle = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(column.name).font(.headline)
                Text("\(tasks.count)").font(.caption).padding(.horizontal, 6).background(.quaternary, in: Capsule())
                Spacer()
            }
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(tasks) { t in
                        NavigationLink { TaskDetailView(task: t) } label: { KanbanCard(task: t) }
                            .buttonStyle(.plain)
                            .draggable(t.id.uuidString)
                    }
                    if column.kind == .todo || column.kind == .inbox {
                        TextField("Новая задача…", text: $quickTitle).textFieldStyle(.roundedBorder).font(.subheadline)
                            .onSubmit {
                                guard !quickTitle.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                                let t = env.repo.create(title: quickTitle); env.repo.move(t, to: column); quickTitle = ""
                            }
                    }
                }
            }
        }
        .padding(10)
        .frame(width: 290)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(targeted ? Color.accentColor.opacity(0.12) : Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
        .dropDestination(for: String.self) { ids, _ in
            for id in ids.compactMap(UUID.init(uuidString:)) { if let t = env.repo.task(id) { env.repo.move(t, to: column) } }
            return true
        } isTargeted: { targeted = $0 }
    }
}

struct KanbanCard: View {
    @Environment(AppEnvironment.self) private var env
    let task: TaskItem
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack { PriorityBadge(priority: task.priority); Spacer(); Image(systemName: task.kind.symbol).font(.caption).foregroundStyle(.secondary) }
            Text(task.title).font(.subheadline).lineLimit(3).multilineTextAlignment(.leading)
            if !env.repo.categoryPath(task).isEmpty { Text(env.repo.categoryPath(task)).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            HStack(spacing: 6) {
                if let d = task.dueAt { Chip(text: DateService.relativeLabel(d), systemImage: "calendar", tint: task.isOverdue ? .red : .secondary) }
                if let r = task.reminderAt, r > .now { Image(systemName: "bell").font(.caption2).foregroundStyle(.orange) }
                if task.sourceId != nil { Image(systemName: "waveform").font(.caption2).foregroundStyle(.secondary) }
            }
            if !task.tags.isEmpty { Text(task.tags.map { "#\($0)" }.joined(separator: " ")).font(.caption2).foregroundStyle(.blue) }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
    }
}

struct ColumnsEditorView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \StatusColumn.sortOrder) private var columns: [StatusColumn]
    @State private var newName = ""

    var body: some View {
        List {
            Section("Колонки") {
                ForEach(columns) { c in
                    HStack {
                        TextField("Название", text: Binding(get: { c.name }, set: { env.repo.renameStatus(c, to: $0) }))
                        Spacer()
                        if c.kind != .custom { Text(c.kind.rawValue).font(.caption2).foregroundStyle(.secondary) }
                    }
                }
                .onDelete { idx in idx.map { columns[$0] }.forEach { env.repo.deleteStatus($0) } }
            }
            Section("Добавить статус") {
                HStack {
                    TextField("Например: На согласовании", text: $newName)
                    Button("Добавить") { env.repo.createStatus(name: newName); newName = "" }.disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            Text("Системные колонки (Inbox, To Do, В работе, Жду ответ, Завершено) можно переименовать, но не удалить.").font(.footnote).foregroundStyle(.secondary)
        }
        .navigationTitle("Статусы")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
    }
}
