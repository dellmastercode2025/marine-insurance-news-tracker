import SwiftData
import SwiftUI

/// Date views: Today / Tomorrow / Week / Month / Overdue / No date (spec §9).
struct PlanView: View {
    enum Mode: String, CaseIterable, Identifiable { case today = "Сегодня", tomorrow = "Завтра", week = "Неделя", month = "Месяц", overdue = "Просрочено", noDate = "Без срока"; var id: String { rawValue } }
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<TaskItem> { $0.deletedAt == nil && $0.completedAt == nil }, sort: \TaskItem.dueAt) private var open: [TaskItem]
    @State private var mode: Mode = .today
    @State private var selection = Set<UUID>()
    @State private var showReschedule = false
    @State private var newDate = Date()

    private var filtered: [TaskItem] {
        let cal = DateService.calendar
        let start = DateService.startOfDay()
        switch mode {
        case .today: return open.filter { $0.dueAt.map(DateService.isToday) ?? false }
        case .tomorrow: return open.filter { $0.dueAt.map(DateService.isTomorrow) ?? false }
        case .week: let end = cal.date(byAdding: .day, value: 7, to: start)!; return open.filter { ($0.dueAt ?? .distantPast) >= start && $0.dueAt! < end }
        case .month: let end = cal.date(byAdding: .month, value: 1, to: start)!; return open.filter { ($0.dueAt ?? .distantPast) >= start && $0.dueAt! < end }
        case .overdue: return open.filter(\.isOverdue)
        case .noDate: return open.filter { $0.dueAt == nil }
        }
    }

    private var grouped: [(String, [TaskItem])] {
        let groups = Dictionary(grouping: filtered) { t -> String in t.dueAt.map { $0.formatted(.dateTime.weekday(.wide).day().month()) } ?? "Без срока" }
        return groups.sorted { ($0.value.first?.dueAt ?? .distantFuture) < ($1.value.first?.dueAt ?? .distantFuture) }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Режим", selection: $mode) { ForEach(Mode.allCases) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented).padding()
            List(selection: $selection) {
                if filtered.isEmpty { EmptyHint(text: "Ничего нет", systemImage: "checkmark.seal") }
                ForEach(grouped, id: \.0) { title, items in
                    Section(title) {
                        ForEach(items) { t in
                            NavigationLink { TaskDetailView(task: t) } label: { TaskRowView(task: t) }.tag(t.id)
                                .swipeActions(edge: .leading) { Button { env.repo.complete(t) } label: { Label("Готово", systemImage: "checkmark") }.tint(.green) }
                        }
                    }
                }
            }
            .environment(\.editMode, .constant(selection.isEmpty ? .inactive : .active))
        }
        .navigationTitle("План")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() } }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Выбрать все") { selection = Set(filtered.map(\.id)) }
                    Button("Перенести выбранные…") { showReschedule = true }.disabled(selection.isEmpty)
                    Button("Снять выбор") { selection.removeAll() }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .sheet(isPresented: $showReschedule) {
            NavigationStack {
                Form {
                    DatePicker("Новая дата", selection: $newDate, displayedComponents: [.date, .hourAndMinute])
                    Text("Будет перенесено: \(selection.count). Действие можно отменить (UNDO).").font(.footnote).foregroundStyle(.secondary)
                }
                .navigationTitle("Перенос задач")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Перенести") {
                            let tasks = open.filter { selection.contains($0.id) }
                            _ = env.repo.reschedule(tasks, to: newDate, keepTime: false)
                            selection.removeAll(); showReschedule = false
                        }
                    }
                    ToolbarItem(placement: .cancellationAction) { Button("Отмена") { showReschedule = false } }
                }
            }
            .presentationDetents([.medium])
        }
    }
}
