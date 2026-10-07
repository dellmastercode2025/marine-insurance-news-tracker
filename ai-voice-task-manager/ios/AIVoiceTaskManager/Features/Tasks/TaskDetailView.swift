import AVFoundation
import SwiftData
import SwiftUI

struct TaskDetailView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Bindable var task: TaskItem
    @Query(sort: \StatusColumn.sortOrder) private var columns: [StatusColumn]
    @Query(sort: \Person.name) private var people: [Person]
    @State private var hasDue = false
    @State private var hasReminder = false
    @State private var hasFollowUp = false
    @State private var newProjectName = ""
    @State private var newAreaName = ""
    @State private var tagsText = ""
    @State private var showDeleteConfirm = false
    @State private var newReminderDate = Date().addingTimeInterval(3600)

    private var source: VoiceEntry? { task.sourceId.flatMap { try? SyncService.find(VoiceEntry.self, $0, env.repo.context) } }

    var body: some View {
        Form {
            Section {
                TextField("Название", text: $task.title, axis: .vertical)
                TextField("Описание", text: Binding(get: { task.taskDescription ?? "" }, set: { task.taskDescription = $0.isEmpty ? nil : $0 }), axis: .vertical)
                Picker("Тип", selection: Binding(get: { task.kind }, set: { task.kind = $0 })) { ForEach(TaskKind.allCases) { Text($0.label).tag($0) } }
                Picker("Приоритет", selection: Binding(get: { task.priority }, set: { task.priority = $0 })) { ForEach(Priority.allCases) { Text($0.label).tag($0) } }
                Picker("Статус", selection: Binding(get: { task.statusId }, set: { id in if let c = columns.first(where: { $0.id == id }) { env.repo.move(task, to: c) } })) {
                    ForEach(columns) { Text($0.name).tag(UUID?.some($0.id)) }
                }
            }
            Section("Проект и направление") {
                CategoryPicker(projectId: Binding(get: { task.projectId }, set: { env.repo.reclassify(task, projectId: $0, areaId: nil) }),
                               areaId: Binding(get: { task.areaId }, set: { env.repo.reclassify(task, projectId: task.projectId, areaId: $0) }),
                               newProjectName: $newProjectName, newAreaName: $newAreaName)
                if task.projectId == nil, !newProjectName.isEmpty {
                    Button("Создать проект «\(newProjectName)»") {
                        if let ws = (try? env.repo.context.fetch(FetchDescriptor<Workspace>(sortBy: [SortDescriptor(\.sortOrder)])))?.first {
                            let p = env.repo.createProject(name: newProjectName, workspaceId: ws.id); env.repo.reclassify(task, projectId: p.id, areaId: nil); newProjectName = ""
                        }
                    }
                }
                if let pid = task.projectId, task.areaId == nil, !newAreaName.isEmpty {
                    Button("Создать направление «\(newAreaName)»") { let a = env.repo.createArea(name: newAreaName, projectId: pid); env.repo.reclassify(task, projectId: pid, areaId: a.id); newAreaName = "" }
                }
                if task.aiConfidence != nil { Text("Уверенность AI: \(Int((task.aiConfidence ?? 0) * 100))%. Перенос в другую категорию обучает классификатор.").font(.caption2).foregroundStyle(.secondary) }
            }
            Section("Сроки") {
                Toggle("Срок", isOn: $hasDue.animation()).onChange(of: hasDue) { _, on in task.dueAt = on ? (task.dueAt ?? DateService.combine(day: .now, hhmm: env.repo.prefs.endOfDayTime)) : nil }
                if hasDue { DatePicker("Срок", selection: Binding(get: { task.dueAt ?? .now }, set: { task.dueAt = $0 })) }
                if task.kind == .event {
                    DatePicker("Начало", selection: Binding(get: { task.startAt ?? task.dueAt ?? .now }, set: { task.startAt = $0 }))
                    DatePicker("Конец", selection: Binding(get: { task.eventEndAt ?? (task.startAt ?? .now).addingTimeInterval(3600) }, set: { task.eventEndAt = $0 }))
                }
                Toggle("Напоминание", isOn: $hasReminder.animation()).onChange(of: hasReminder) { _, on in task.reminderAt = on ? (task.reminderAt ?? DateService.combine(day: .now, hhmm: env.repo.prefs.morningTime)) : nil }
                if hasReminder { DatePicker("Напомнить", selection: Binding(get: { task.reminderAt ?? .now }, set: { task.reminderAt = $0 })) }
                let extra = env.repo.reminders(for: task.id).filter { $0.fireAt > .now }
                if !extra.isEmpty { ForEach(extra) { r in Label("\(DateService.absoluteLabel(r.fireAt))\(r.repeatRule.map { " · \($0)" } ?? "")", systemImage: r.kind == "follow_up" ? "hourglass" : "bell").font(.caption) } }
                HStack { DatePicker("Ещё напоминание", selection: $newReminderDate); Button("＋") { env.repo.addReminder(task, at: newReminderDate) } }
                if let rule = task.recurrenceRule { Label("Повтор: \(rule)", systemImage: "repeat").font(.caption) }
            }
            Section("Ожидание ответа") {
                Toggle("Жду ответ", isOn: Binding(get: { task.isWaiting }, set: { on in task.isWaiting = on; if on, let w = columns.first(where: { $0.kind == .waiting }) { task.statusId = w.id } }))
                if task.isWaiting {
                    Picker("От кого", selection: $task.waitingForPersonId) { Text("—").tag(UUID?.none); ForEach(people) { Text($0.name).tag(UUID?.some($0.id)) } }
                    TextField("Предмет", text: Binding(get: { task.waitingSubject ?? "" }, set: { task.waitingSubject = $0.isEmpty ? nil : $0 }))
                    Toggle("Контрольная дата (follow-up)", isOn: $hasFollowUp.animation()).onChange(of: hasFollowUp) { _, on in task.followUpAt = on ? (task.followUpAt ?? task.dueAt ?? Date().addingTimeInterval(86400 * 2)) : nil }
                    if hasFollowUp { DatePicker("Напомнить о follow-up", selection: Binding(get: { task.followUpAt ?? .now }, set: { task.followUpAt = $0 })) }
                    Button("Ответ получен — закрыть") { env.repo.complete(task) }
                }
            }
            Section("Связи") {
                Picker("Человек", selection: $task.personId) { Text("—").tag(UUID?.none); ForEach(people) { Text($0.name).tag(UUID?.some($0.id)) } }
                TextField("Теги через запятую", text: $tagsText).onAppear { tagsText = task.tags.joined(separator: ", ") }
                    .onSubmit { task.tags = tagsText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }
                if env.calendar.hasAccess {
                    if task.calendarEventId != nil { Label("Связано с событием календаря", systemImage: "calendar.badge.checkmark"); Button("Обновить событие") { env.repo.linkToCalendar(task) } }
                    else if task.dueAt != nil || task.startAt != nil { Button { env.repo.linkToCalendar(task) } label: { Label("Создать событие в Календаре", systemImage: "calendar.badge.plus") } }
                }
                if task.appleReminderId != nil { Label("Есть в Apple Напоминаниях", systemImage: "list.bullet").font(.caption) }
            }
            if let src = source {
                Section("Исходная запись") {
                    Text(src.createdAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                    if let q = task.originalTranscript { Text("«\(q)»").font(.footnote) }
                    if let t = src.cleanTranscript { DisclosureGroup("Полная расшифровка") { Text(t).font(.footnote) } }
                    if src.audioFileName != nil { AudioPlayerButton(fileName: src.audioFileName!) }
                }
            } else if let q = task.originalTranscript {
                Section("Из голосового сообщения") { Text("«\(q)»").font(.footnote) }
            }
            Section {
                Button(task.isDone ? "Вернуть в работу" : "Выполнено") { env.repo.complete(task, done: !task.isDone) }
                Button("Удалить", role: .destructive) { showDeleteConfirm = true }
            }
        }
        .navigationTitle(task.kind.label)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { hasDue = task.dueAt != nil; hasReminder = task.reminderAt != nil; hasFollowUp = task.followUpAt != nil }
        .onDisappear { env.repo.save(task) }
        .confirmationDialog("Удалить задачу?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { env.repo.softDelete(task); dismiss() }
        }
    }
}

struct AudioPlayerButton: View {
    let fileName: String
    @State private var player: AVAudioPlayer?
    @State private var playing = false
    var body: some View {
        Button { toggle() } label: { Label(playing ? "Стоп" : "Прослушать", systemImage: playing ? "stop.circle" : "play.circle") }
    }
    private func toggle() {
        if playing { player?.stop(); playing = false; return }
        let url = AudioRecorder.audioDirectory.appendingPathComponent(fileName)
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        player = try? AVAudioPlayer(contentsOf: url); player?.play(); playing = player?.isPlaying ?? false
    }
}
