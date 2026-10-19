import Foundation
import Observation
import SwiftData
import SwiftUI

/// Composition root. One instance per process, shared with App Intents through `AppEnvironment.shared`.
@MainActor
@Observable
final class AppEnvironment {
    static let shared = AppEnvironment()

    let container: ModelContainer
    let client: SupabaseClient
    let api: APIService
    let network: NetworkMonitor
    let notifications: NotificationService
    let calendar: CalendarService
    let reminders: RemindersService
    let repo: TaskRepository
    let sync: SyncService
    let voice: VoiceProcessingCoordinator
    let appLock: AppLock

    var isAuthenticated = false
    var selectedTab: Tab = .today
    var showRecorder = false
    var openTaskId: UUID?

    enum Tab: Hashable { case today, board, chat, projects, more }

    private init() {
        let schema = Schema(ModelSchemaV1.models)
        let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false, allowsSave: true)
        do { container = try ModelContainer(for: schema, configurations: [config]) }
        catch {
            // Schema changed during development: start fresh rather than crash-loop.
            let fallback = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
            container = try! ModelContainer(for: schema, configurations: [fallback])
        }
        client = SupabaseClient()
        api = APIService(client: client)
        network = NetworkMonitor()
        notifications = NotificationService.shared
        calendar = CalendarService()
        reminders = RemindersService()
        repo = TaskRepository(context: container.mainContext, notifications: notifications, calendar: calendar, remindersService: reminders, client: client)
        sync = SyncService(client: client, container: container)
        voice = VoiceProcessingCoordinator(api: api, repo: repo, network: network)
        appLock = AppLock()
        UndoService.shared.api = api
        UndoService.shared.afterUndo = { [weak self] in Task { await self?.sync.syncNow(); self?.repo.rearmAllNotifications() } }
        repo.ensureDefaults()
        wire()
    }

    private func wire() {
        network.onBecameOnline = { [weak self] in Task { @MainActor in await self?.sync.syncNow(); await self?.voice.processPending() } }
        notifications.onOpenTask = { [weak self] id in Task { @MainActor in self?.openTaskId = id } }
        NotificationCenter.default.addObserver(forName: .completeTaskFromNotification, object: nil, queue: .main) { [weak self] n in
            let id = n.object as? UUID
            Task { @MainActor in guard let self, let id, let t = self.repo.task(id) else { return }; self.repo.complete(t) }
        }
        NotificationCenter.default.addObserver(forName: .snoozeTaskFromNotification, object: nil, queue: .main) { [weak self] n in
            let id = n.object as? UUID
            Task { @MainActor in guard let self, let id, let t = self.repo.task(id) else { return }; self.repo.snooze(t) }
        }
        NotificationCenter.default.addObserver(forName: .startRecording, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.showRecorder = true } }
        NotificationCenter.default.addObserver(forName: .openTask, object: nil, queue: .main) { [weak self] n in
            let id = n.object as? UUID
            Task { @MainActor in self?.openTaskId = id }
        }
    }

    func bootstrap() async {
        isAuthenticated = await client.isAuthenticated
        if isAuthenticated { await didSignIn() }
    }

    func didSignIn() async {
        isAuthenticated = true
        _ = await notifications.requestPermission()
        await calendar.requestAccess()
        if repo.prefs.appleRemindersSync != .off { await reminders.requestAccess() }
        await sync.syncNow()
        repo.ensureDefaults()
        repo.rearmAllNotifications()
        notifications.scheduleDailyBriefing(at: repo.prefs.briefingTime, enabled: true)
        await voice.processPending()
    }

    func signOut() async {
        await client.signOut()
        sync.resetCursors()
        isAuthenticated = false
    }

    func handle(url: URL) {
        guard url.scheme == AppConfig.urlScheme else { return }
        if url.host == "task", let id = UUID(uuidString: url.lastPathComponent) { openTaskId = id }
        if url.host == "record" { showRecorder = true }
        if url.host == "mail-connected" { NotificationCenter.default.post(name: .mailConnected, object: url) }
        if url.host == "auth-callback" { NotificationCenter.default.post(name: .authCallback, object: url) }
    }
}

extension Notification.Name {
    static let mailConnected = Notification.Name("mailConnected")
    static let authCallback = Notification.Name("authCallback")
}
