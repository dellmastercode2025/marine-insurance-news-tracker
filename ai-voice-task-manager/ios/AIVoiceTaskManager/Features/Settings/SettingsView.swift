import SwiftData
import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @State private var showDeleteAccount = false
    @State private var exportURL: URL?
    @State private var aliasKey = ""
    @State private var aliasValue = ""
    @State private var faceID = false

    var body: some View {
        @Bindable var prefs = env.repo.prefs
        Form {
            Section("Время суток") {
                timeRow("Утро", $prefs.morningTime); timeRow("День", $prefs.dayTime); timeRow("Вечер", $prefs.eveningTime); timeRow("Ночь", $prefs.nightTime)
                timeRow("Срок без времени", $prefs.endOfDayTime)
                timeRow("Утренняя сводка", $prefs.briefingTime)
            }
            Section("AI") {
                Picker("Приоритет по умолчанию", selection: $prefs.defaultPriority) { ForEach(Priority.allCases) { Text($0.label).tag($0.rawValue) } }
                VStack(alignment: .leading) {
                    Text("Порог авто-распределения: \(Int(prefs.autoFileThreshold * 100))%")
                    Slider(value: $prefs.autoFileThreshold, in: 0.5...0.99, step: 0.01)
                    Text("Ниже порога приложение спросит, куда отнести задачу.").font(.caption2).foregroundStyle(.secondary)
                }
                NavigationLink("Синонимы и правила маршрутизации") { AliasesView() }
            }
            Section("Голос и приватность") {
                Toggle("Удалять аудио после расшифровки", isOn: $prefs.deleteAudioAfterTranscription)
                Toggle("Private processing mode", isOn: $prefs.privateMode)
                Text("В приватном режиме аудио уничтожается сразу после расшифровки, расшифровки и история чата не сохраняются на сервере, в AI передаётся минимальный контекст.").font(.caption2).foregroundStyle(.secondary)
                Toggle("Блокировка Face ID", isOn: $faceID).onChange(of: faceID) { _, on in env.appLock.setEnabled(on) }
            }
            Section("Apple") {
                Picker("Синхронизация с Напоминаниями", selection: Binding(get: { prefs.appleRemindersSync }, set: { prefs.appleRemindersSync = $0; if $0 != .off { Task { await env.reminders.requestAccess() } } })) {
                    ForEach(AppleRemindersSync.allCases) { Text($0.label).tag($0) }
                }
                HStack { Text("Календарь"); Spacer(); Text(env.calendar.hasAccess ? "Подключён" : "Нет доступа").foregroundStyle(.secondary) }
                if !env.calendar.hasAccess { Button("Запросить доступ к календарю") { Task { await env.calendar.requestAccess() } } }
                Text("Siri: «Добавь задачу в Voice Tasks», «Что у меня сегодня в Voice Tasks», «Начни запись в Voice Tasks». Все действия доступны в Shortcuts.").font(.caption2).foregroundStyle(.secondary)
            }
            Section("Данные") {
                HStack { Text("Синхронизация"); Spacer(); Text(env.sync.lastSyncAt?.formatted(date: .omitted, time: .shortened) ?? "—").foregroundStyle(.secondary) }
                Button("Синхронизировать сейчас") { Task { await env.sync.syncNow() } }
                Button("Пересчитать семантический индекс") { Task { try? await env.api.embedMissing() } }
                Button("Экспорт данных (JSON)") { Task { await export() } }
                Button("Удалить историю AI-чата", role: .destructive) { deleteChat() }
                Button("Удалить все аудиофайлы", role: .destructive) { deleteAudio() }
            }
            Section("Аккаунт") {
                Button("Выйти") { Task { await env.signOut(); dismiss() } }
                Button("Удалить аккаунт и все данные", role: .destructive) { showDeleteAccount = true }
            }
        }
        .navigationTitle("Настройки")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
        .onAppear { faceID = env.appLock.isEnabled }
        .onDisappear { prefs.updatedAt = .now; try? env.repo.context.save(); Task { await env.sync.pushPreferences(prefs) }; env.notifications.scheduleDailyBriefing(at: prefs.briefingTime, enabled: true) }
        .confirmationDialog("Удалить аккаунт? Это необратимо.", isPresented: $showDeleteAccount, titleVisibility: .visible) {
            Button("Удалить навсегда", role: .destructive) { Task { _ = try? await env.client.rpc("delete_my_account", params: [:]); await env.signOut(); dismiss() } }
        }
        .sheet(item: Binding(get: { exportURL.map { IdentifiedURL(url: $0) } }, set: { exportURL = $0?.url })) { ShareSheet(url: $0.url) }
    }

    private func timeRow(_ title: String, _ binding: Binding<String>) -> some View {
        DatePicker(title, selection: Binding(get: { DateService.combine(day: .now, hhmm: binding.wrappedValue) }, set: { d in
            let c = Calendar.current.dateComponents([.hour, .minute], from: d)
            binding.wrappedValue = String(format: "%02d:%02d", c.hour ?? 9, c.minute ?? 0)
        }), displayedComponents: .hourAndMinute)
    }

    private func export() async {
        guard let data = try? await env.client.rpc("export_my_data", params: [:]) else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-tasks-export.json")
        try? data.write(to: url); exportURL = url
    }
    private func deleteChat() {
        let ctx = env.repo.context
        (try? ctx.fetch(FetchDescriptor<ChatMessage>()))?.forEach { ctx.delete($0) }
        try? ctx.save()
        Task { _ = try? await env.client.rpc("delete_my_chat_history", params: [:]) }
    }
    private func deleteAudio() {
        let ctx = env.repo.context
        for e in (try? ctx.fetch(FetchDescriptor<VoiceEntry>())) ?? [] { env.voice.deleteAudio(e) }
        try? ctx.save()
    }
}

struct AliasesView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var key = ""
    @State private var value = ""
    @State private var ruleKey = ""
    @State private var ruleValue = ""
    var body: some View {
        @Bindable var prefs = env.repo.prefs
        List {
            Section("Синонимы (как вы говорите → как называется)") {
                ForEach(prefs.aliases.sorted(by: { $0.key < $1.key }), id: \.key) { k, v in HStack { Text(k); Spacer(); Text(v).foregroundStyle(.secondary) } }
                    .onDelete { idx in let keys = prefs.aliases.keys.sorted(); idx.forEach { prefs.aliases.removeValue(forKey: keys[$0]) } }
                HStack { TextField("KMTF", text: $key); TextField("Казмортрансфлот", text: $value); Button("＋") { prefs.aliases[key] = value; key = ""; value = "" }.disabled(key.isEmpty || value.isEmpty) }
            }
            Section("Правила: фраза → Проект/Направление") {
                ForEach(prefs.routingRules.sorted(by: { $0.key < $1.key }), id: \.key) { k, v in HStack { Text(k); Spacer(); Text(v).foregroundStyle(.secondary) } }
                    .onDelete { idx in let keys = prefs.routingRules.keys.sorted(); idx.forEach { prefs.routingRules.removeValue(forKey: keys[$0]) } }
                HStack { TextField("риски", text: $ruleKey); TextField("Казмортрансфлот/Управление рисками", text: $ruleValue); Button("＋") { prefs.routingRules[ruleKey] = ruleValue; ruleKey = ""; ruleValue = "" }.disabled(ruleKey.isEmpty || ruleValue.isEmpty) }
            }
            Text("Кроме явных правил, парсер учится на ваших переносах: если задачу с похожей формулировкой три раза перенесли в другую категорию, это учитывается автоматически.").font(.footnote).foregroundStyle(.secondary)
        }
        .navigationTitle("Синонимы и правила")
        .onDisappear { prefs.updatedAt = .now; Task { await env.sync.pushPreferences(prefs) } }
    }
}

struct IdentifiedURL: Identifiable { let url: URL; var id: URL { url } }

struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
