import SwiftUI

/// "Я нашёл N действий" – review, edit, disambiguate and confirm (spec §4.1, §18).
struct ExtractionReviewView: View {
    @Environment(AppEnvironment.self) private var env
    let proposal: ParseResponse
    var onDone: () -> Void

    @State private var items: [ResolvedItem]
    @State private var editing: ResolvedItem?
    @State private var error: String?
    @State private var showTranscript = false

    init(proposal: ParseResponse, onDone: @escaping () -> Void) {
        self.proposal = proposal; self.onDone = onDone
        _items = State(initialValue: proposal.items)
    }

    private var countLabel: String {
        let n = items.count
        let word = n % 10 == 1 && n % 100 != 11 ? "действие" : (2...4).contains(n % 10) && !(12...14).contains(n % 100) ? "действия" : "действий"
        return n == 0 ? "Действий не найдено" : "Я нашёл \(n) \(word)"
    }

    var body: some View {
        VStack(spacing: 0) {
            List {
                Section {
                    Text(countLabel).font(.title3.bold())
                    if !proposal.summary.isEmpty { Text(proposal.summary).font(.subheadline).foregroundStyle(.secondary) }
                    Button { showTranscript.toggle() } label: { Label(showTranscript ? "Скрыть расшифровку" : "Показать расшифровку", systemImage: "text.quote").font(.footnote) }
                    if showTranscript, let t = env.voice.activeEntry?.cleanTranscript { Text(t).font(.footnote).foregroundStyle(.secondary) }
                }
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    Section {
                        ItemCard(index: index + 1, item: item)
                            .contentShape(Rectangle())
                            .onTapGesture { editing = item }
                        if item.needsDisambiguation, let options = item.disambiguationOptions {
                            VStack(alignment: .leading, spacing: 6) {
                                Label("Я не уверен, куда отнести. Выберите:", systemImage: "questionmark.circle").font(.caption).foregroundStyle(.orange)
                                ForEach(options) { opt in
                                    Button { choose(opt, for: item) } label: {
                                        HStack { Text(opt.label); Spacer(); if opt.projectId == item.projectId && opt.areaId == item.areaId { Image(systemName: "checkmark") } }
                                    }.font(.subheadline)
                                }
                            }
                        }
                        if let w = item.warnings, !w.isEmpty { ForEach(w, id: \.self) { Label($0, systemImage: "exclamationmark.triangle").font(.caption2).foregroundStyle(.secondary) } }
                    }
                    .swipeActions { Button(role: .destructive) { items.removeAll { $0.id == item.id } } label: { Label("Убрать", systemImage: "trash") } }
                }
            }
            .listStyle(.insetGrouped)
            if let error { Text(error).font(.footnote).foregroundStyle(.red).padding(.horizontal) }
            HStack(spacing: 12) {
                Button(role: .destructive) { env.voice.discard(); onDone() } label: { Text("Отменить").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
                Button { if let first = items.first { editing = first } } label: { Text("Изменить").frame(maxWidth: .infinity) }.buttonStyle(.bordered).disabled(items.isEmpty)
                Button { Task { await commit() } } label: {
                    if env.voice.stage == .committing { ProgressView().frame(maxWidth: .infinity) } else { Text("Добавить всё").frame(maxWidth: .infinity) }
                }.buttonStyle(.borderedProminent).disabled(items.isEmpty || env.voice.stage == .committing)
            }
            .padding()
        }
        .sheet(item: $editing) { item in
            NavigationStack { ItemEditorView(item: item) { updated in if let i = items.firstIndex(where: { $0.id == updated.id }) { items[i] = updated } } }
        }
    }

    private func choose(_ opt: DisambiguationOption, for item: ResolvedItem) {
        guard let i = items.firstIndex(where: { $0.id == item.id }) else { return }
        items[i].projectId = opt.projectId; items[i].project = opt.project
        items[i].areaId = opt.areaId; items[i].area = opt.area
        items[i].needsDisambiguation = false; items[i].autoFile = true
    }

    private func commit() async {
        do { _ = try await env.voice.commit(items: items); onDone() }
        catch { self.error = error.localizedDescription }
    }
}

struct ItemCard: View {
    let index: Int
    let item: ResolvedItem
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(index). \(item.type.label)").font(.caption.bold()).foregroundStyle(.secondary)
                Spacer()
                PriorityBadge(priority: item.priorityValue)
                if item.confidence < 0.85 { Chip(text: "\(Int(item.confidence * 100))%", systemImage: "gauge.with.dots.needle.33percent", tint: .orange) }
            }
            if !item.categoryPath.isEmpty { Text(item.categoryPath).font(.caption).foregroundStyle(.blue) }
            Text(item.title).font(.body.weight(.medium))
            HStack(spacing: 8) {
                if let d = item.dueDate { Chip(text: "Срок: \(DateService.absoluteLabel(d))", systemImage: "calendar") }
                if let r = item.reminderDate { Chip(text: DateService.absoluteLabel(r), systemImage: "bell", tint: .orange) }
                if let s = item.eventStartDate { Chip(text: DateService.absoluteLabel(s), systemImage: "calendar.badge.clock", tint: .green) }
            }
            if let w = item.waitingFor { Chip(text: "Жду: \(w)\(item.waitingSubject.map { " · \($0)" } ?? "")", systemImage: "hourglass", tint: .purple) }
            else if let p = item.person { Chip(text: p, systemImage: "person", tint: .purple) }
            if let q = item.sourceQuote, !q.isEmpty { Text("«\(q)»").font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
        }
    }
}

struct ItemEditorView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @State var item: ResolvedItem
    var onSave: (ResolvedItem) -> Void
    @State private var hasDue: Bool
    @State private var due: Date
    @State private var hasReminder: Bool
    @State private var reminder: Date

    init(item: ResolvedItem, onSave: @escaping (ResolvedItem) -> Void) {
        _item = State(initialValue: item); self.onSave = onSave
        _hasDue = State(initialValue: item.dueDate != nil); _due = State(initialValue: item.dueDate ?? DateService.combine(day: .now, hhmm: "18:00"))
        _hasReminder = State(initialValue: item.reminderDate != nil); _reminder = State(initialValue: item.reminderDate ?? DateService.combine(day: .now, hhmm: "09:00"))
    }

    var body: some View {
        Form {
            Section("Что") {
                TextField("Название", text: $item.title)
                Picker("Тип", selection: $item.type) { ForEach(TaskKind.allCases) { Text($0.label).tag($0) } }
                Picker("Приоритет", selection: Binding(get: { item.priorityValue }, set: { item.priority = $0.rawValue })) { ForEach(Priority.allCases) { Text($0.label).tag($0) } }
            }
            Section("Куда") {
                CategoryPicker(projectId: Binding(get: { item.projectId.flatMap(UUID.init(uuidString:)) }, set: { id in item.projectId = id?.uuidString.lowercased(); item.project = env.repo.project(id)?.name }),
                               areaId: Binding(get: { item.areaId.flatMap(UUID.init(uuidString:)) }, set: { id in item.areaId = id?.uuidString.lowercased(); item.area = env.repo.area(id)?.name }),
                               newProjectName: Binding(get: { item.projectId == nil ? (item.project ?? "") : "" }, set: { item.project = $0.isEmpty ? nil : $0; item.projectId = nil }),
                               newAreaName: Binding(get: { item.areaId == nil ? (item.area ?? "") : "" }, set: { item.area = $0.isEmpty ? nil : $0; item.areaId = nil }))
            }
            Section("Когда") {
                Toggle("Срок", isOn: $hasDue)
                if hasDue { DatePicker("Срок", selection: $due) }
                Toggle("Напоминание", isOn: $hasReminder)
                if hasReminder { DatePicker("Напомнить", selection: $reminder) }
            }
            if item.type == .waiting {
                Section("Ожидание") {
                    TextField("От кого", text: Binding(get: { item.waitingFor ?? "" }, set: { item.waitingFor = $0.isEmpty ? nil : $0 }))
                    TextField("Что", text: Binding(get: { item.waitingSubject ?? "" }, set: { item.waitingSubject = $0.isEmpty ? nil : $0 }))
                }
            }
        }
        .navigationTitle("Изменить")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Сохранить") {
                    item.dueAt = hasDue ? ISO8601.string(due) : nil
                    item.reminderAt = hasReminder ? ISO8601.string(reminder) : nil
                    item.needsDisambiguation = false; item.autoFile = true
                    onSave(item); dismiss()
                }
            }
        }
    }
}
