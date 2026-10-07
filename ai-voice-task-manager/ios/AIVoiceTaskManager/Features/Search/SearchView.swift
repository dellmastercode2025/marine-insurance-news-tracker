import SwiftData
import SwiftUI

/// Keyword search locally (instant) + semantic search on the backend (spec §19).
struct SearchView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<TaskItem> { $0.deletedAt == nil }) private var tasks: [TaskItem]
    @State private var query = ""
    @State private var remote: SearchResponse?
    @State private var searching = false

    private var local: [TaskItem] {
        let q = query.lowercased()
        guard q.count >= 2 else { return [] }
        return tasks.filter { t in
            t.title.lowercased().contains(q) || (t.taskDescription?.lowercased().contains(q) ?? false) || (t.cleanTranscript?.lowercased().contains(q) ?? false)
                || (t.originalTranscript?.lowercased().contains(q) ?? false) || t.tags.contains { $0.lowercased().contains(q) }
                || (env.repo.project(t.projectId)?.name.lowercased().contains(q) ?? false) || (env.repo.person(t.personId)?.name.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        List {
            if !local.isEmpty { Section("Совпадения") { ForEach(local.prefix(30)) { t in NavigationLink { TaskDetailView(task: t) } label: { TaskRowView(task: t) } } } }
            if let r = remote {
                let semantic = r.tasks.filter { hit in !local.contains { $0.id.uuidString.lowercased() == hit.id } }
                if !semantic.isEmpty {
                    Section("По смыслу (AI)") {
                        ForEach(semantic) { hit in
                            if let id = UUID(uuidString: hit.id), let t = env.repo.task(id) { NavigationLink { TaskDetailView(task: t) } label: { TaskRowView(task: t) } }
                            else { Text(hit.title) }
                        }
                    }
                }
                if !r.people.isEmpty { Section("Люди") { ForEach(r.people) { Text($0.name) } } }
            }
            if searching { HStack { ProgressView(); Text("Семантический поиск…").font(.caption).foregroundStyle(.secondary) } }
            if query.count >= 2, local.isEmpty, remote?.tasks.isEmpty ?? true, !searching { EmptyHint(text: "Ничего не найдено", systemImage: "magnifyingglass") }
        }
        .searchable(text: $query, prompt: "Например: письмо про страховку, где были недовольны брокером")
        .onSubmit(of: .search) { Task { await remoteSearch() } }
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(700))
            if !Task.isCancelled, query.count >= 4 { await remoteSearch() }
        }
        .navigationTitle("Поиск")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
    }

    private func remoteSearch() async {
        guard env.network.isOnline, query.count >= 2 else { return }
        searching = true; defer { searching = false }
        remote = try? await env.api.search(query)
    }
}
