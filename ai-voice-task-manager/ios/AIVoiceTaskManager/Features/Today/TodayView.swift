import EventKit
import SwiftData
import SwiftUI

/// Greeting, counters, briefing card and the hourly agenda mixing tasks, reminders and Apple Calendar events (spec §9, §23).
struct TodayView: View {
    @Environment(AppEnvironment.self) private var env
    @Query(filter: #Predicate<TaskItem> { $0.deletedAt == nil }, sort: \TaskItem.dueAt) private var tasks: [TaskItem]
    @State private var showPlan = false
    @State private var showSearch = false
    @State private var showInbox = false
    @State private var showSettings = false
    @State private var briefing: BriefingResponse?
    @State private var tick = Date()

    private var open: [TaskItem] { tasks.filter { !$0.isDone } }
    private var today: [TaskItem] { open.filter { ($0.dueAt.map(DateService.isToday) ?? false) || ($0.reminderAt.map(DateService.isToday) ?? false) || ($0.startAt.map(DateService.isToday) ?? false) } }
    private var overdue: [TaskItem] { open.filter { $0.isOverdue && !($0.dueAt.map(DateService.isToday) ?? false) } }
    private var waiting: [TaskItem] { open.filter(\.isWaiting) }
    private var critical: [TaskItem] { today.filter { $0.priority == .p1 } }
    private var inboxCount: Int { let inbox = env.repo.status(kind: .inbox)?.id; return open.filter { $0.statusId == inbox }.count }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    HStack(spacing: 10) {
                        StatCard(title: "Критические", value: critical.count, tint: .red)
                        StatCard(title: "Просроченные", value: overdue.count, tint: .orange)
                        StatCard(title: "Жду ответа", value: waiting.count, tint: .purple)
                    }
                    if inboxCount > 0 {
                        Button { showInbox = true } label: {
                            Label("Inbox: \(inboxCount) — требуется уточнение", systemImage: "tray.full").frame(maxWidth: .infinity, alignment: .leading)
                        }.buttonStyle(.bordered)
                    }
                    BriefingCard(briefing: $briefing)
                    if !overdue.isEmpty { section("Просрочено", overdue) }
                    AgendaView(tasks: today, date: tick)
                    if !waiting.isEmpty { section("Жду ответа", waiting) }
                }
                .padding()
                .padding(.bottom, 80)
            }
            .navigationTitle("Сегодня")
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { showSearch = true } label: { Image(systemName: "magnifyingglass") }
                    Button { showPlan = true } label: { Image(systemName: "calendar") }
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                }
            }
            .sheet(isPresented: $showPlan) { NavigationStack { PlanView() } }
            .sheet(isPresented: $showSearch) { NavigationStack { SearchView() } }
            .sheet(isPresented: $showInbox) { NavigationStack { SmartInboxView() } }
            .sheet(isPresented: $showSettings) { NavigationStack { SettingsView() } }
            .refreshable { await env.sync.syncNow(); tick = .now }
            .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { tick = $0 }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(greeting).font(.largeTitle.bold())
            Text("Сегодня: \(today.count) \(plural(today.count))").foregroundStyle(.secondary)
            if let err = env.sync.lastError { Text(err).font(.caption2).foregroundStyle(.red) }
            if !env.network.isOnline { Label("Офлайн — записи будут обработаны позже", systemImage: "wifi.slash").font(.caption).foregroundStyle(.orange) }
        }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: .now)
        return h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер"
    }
    private func plural(_ n: Int) -> String { n % 10 == 1 && n % 100 != 11 ? "задача" : (2...4).contains(n % 10) && !(12...14).contains(n % 100) ? "задачи" : "задач" }

    @ViewBuilder private func section(_ title: String, _ items: [TaskItem]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            ForEach(items) { t in
                NavigationLink { TaskDetailView(task: t) } label: { TaskRowView(task: t) }.buttonStyle(.plain)
                Divider()
            }
        }
    }
}

/// Timeline 07:00–22:00 with tasks (by due/reminder/start time) and EventKit events.
struct AgendaView: View {
    @Environment(AppEnvironment.self) private var env
    let tasks: [TaskItem]
    let date: Date

    private var events: [EKEvent] { env.calendar.events(from: DateService.startOfDay(date), to: DateService.endOfDay(date)) }

    private func hourKey(_ d: Date) -> Int { Calendar.current.component(.hour, from: d) }
    private func timeOf(_ t: TaskItem) -> Date? {
        if let s = t.startAt, DateService.isToday(s) { return s }
        if let r = t.reminderAt, DateService.isToday(r) { return r }
        if let d = t.dueAt, DateService.isToday(d) { return d }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Agenda").font(.headline)
            let allDay = tasks.filter { timeOf($0) == nil }
            if !allDay.isEmpty {
                ForEach(allDay) { t in NavigationLink { TaskDetailView(task: t) } label: { TaskRowView(task: t) }.buttonStyle(.plain) }
                Divider()
            }
            ForEach(7...22, id: \.self) { hour in
                let hourTasks = tasks.filter { timeOf($0).map { hourKey($0) == hour } ?? false }
                let hourEvents = events.filter { hourKey($0.startDate) == hour && !$0.isAllDay }
                HStack(alignment: .top, spacing: 12) {
                    Text(String(format: "%02d:00", hour)).font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 44, alignment: .trailing)
                    VStack(alignment: .leading, spacing: 6) {
                        if hourTasks.isEmpty && hourEvents.isEmpty { Rectangle().fill(.quaternary).frame(height: 1).padding(.top, 8) }
                        ForEach(hourEvents, id: \.eventIdentifier) { e in
                            HStack {
                                RoundedRectangle(cornerRadius: 2).fill(Color(cgColor: e.calendar.cgColor)).frame(width: 3)
                                VStack(alignment: .leading) {
                                    Text(e.title).font(.subheadline)
                                    Text("\(e.startDate.formatted(date: .omitted, time: .shortened)) – \(e.endDate.formatted(date: .omitted, time: .shortened)) · Календарь").font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                        ForEach(hourTasks) { t in NavigationLink { TaskDetailView(task: t) } label: { TaskRowView(task: t, showProject: true) }.buttonStyle(.plain) }
                    }
                }
            }
        }
    }
}

struct BriefingCard: View {
    @Environment(AppEnvironment.self) private var env
    @Binding var briefing: BriefingResponse?
    @State private var loading = false
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("AI-сводка дня", systemImage: "sparkles").font(.headline)
                Spacer()
                if loading { ProgressView() } else { Button(briefing == nil ? "Сформировать" : "Обновить") { Task { await load() } }.font(.subheadline) }
            }
            if let b = briefing {
                Text(b.headline).font(.subheadline.bold())
                Text("\(b.urgent) срочных · \(b.normal) обычных · \(b.overdue) просроченных · \(b.waiting) ожидают ответа").font(.caption).foregroundStyle(.secondary)
                if !b.narrative.isEmpty { Text(b.narrative).font(.subheadline).lineLimit(expanded ? nil : 3).onTapGesture { expanded.toggle() } }
                if !b.critical.isEmpty {
                    Text("Критично:").font(.caption.bold())
                    ForEach(Array(b.critical.enumerated()), id: \.offset) { i, line in
                        Button { if let id = UUID(uuidString: line.taskId) { env.openTaskId = id } } label: { Text("\(i + 1). \(line.line)").font(.caption).multilineTextAlignment(.leading) }.buttonStyle(.plain)
                    }
                }
            } else { Text("Нажмите, чтобы получить план дня с приоритетами.").font(.caption).foregroundStyle(.secondary) }
        }
        .padding(14)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    private func load() async {
        loading = true; defer { loading = false }
        briefing = try? await env.api.briefing()
    }
}
