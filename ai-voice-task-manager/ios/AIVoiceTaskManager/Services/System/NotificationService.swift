import Foundation
import UserNotifications

/// Local notifications: reminders, follow-ups, overdue nudges, recurring rules, daily briefing (spec §12, §29).
final class NotificationService: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationService()
    private let center = UNUserNotificationCenter.current()
    var onOpenTask: ((UUID) -> Void)?

    override init() {
        super.init()
        center.delegate = self
        let done = UNNotificationAction(identifier: "DONE", title: "Выполнено", options: [])
        let snooze = UNNotificationAction(identifier: "SNOOZE", title: "Через час", options: [])
        let category = UNNotificationCategory(identifier: "TASK", actions: [done, snooze], intentIdentifiers: [], options: [])
        center.setNotificationCategories([category])
    }

    func requestPermission() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    /// Re-plans every notification for a task from scratch (idempotent).
    func schedule(for task: TaskItem, reminders: [ReminderEntry], project: String?) {
        cancel(for: task.id)
        guard !task.isDone, task.deletedAt == nil else { return }
        let subtitle = [project, task.kind == .waiting ? "Жду ответ" : nil].compactMap { $0 }.joined(separator: " · ")
        var fired = Set<Date>()
        for r in reminders where r.fireAt > .now && !fired.contains(r.fireAt) {
            fired.insert(r.fireAt)
            add(id: "task-\(task.id.uuidString)-\(r.id.uuidString)", title: r.kind == "follow_up" ? "Follow-up: \(task.title)" : task.title,
                body: r.kind == "follow_up" ? "Проверьте, пришёл ли ответ\(task.waitingSubject.map { " по теме «\($0)»" } ?? "")" : subtitle,
                at: r.fireAt, rule: r.repeatRule, taskId: task.id)
        }
        if let at = task.reminderAt, at > .now, !fired.contains(at) {
            fired.insert(at)
            add(id: "task-\(task.id.uuidString)-main", title: task.title, body: subtitle, at: at, rule: task.recurrenceRule, taskId: task.id)
        }
        if let at = task.followUpAt, at > .now, !fired.contains(at) {
            add(id: "task-\(task.id.uuidString)-followup", title: "Follow-up: \(task.title)", body: "Проверьте, пришёл ли ответ", at: at, rule: nil, taskId: task.id)
        }
        if let due = task.dueAt, due > .now, task.kind != .event {
            // Overdue nudge one hour after the deadline passed.
            add(id: "task-\(task.id.uuidString)-overdue", title: "Просрочено: \(task.title)", body: "Срок был \(DateService.absoluteLabel(due))", at: due.addingTimeInterval(3600), rule: nil, taskId: task.id)
        }
        if task.kind == .event, let start = task.startAt, start > .now {
            add(id: "task-\(task.id.uuidString)-event", title: task.title, body: "Начало через 15 минут", at: start.addingTimeInterval(-900), rule: nil, taskId: task.id)
        }
    }

    private func add(id: String, title: String, body: String, at: Date, rule: String?, taskId: UUID) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.categoryIdentifier = "TASK"
        content.userInfo = ["taskId": taskId.uuidString]
        let trigger: UNNotificationTrigger
        if let rule, let recurring = Self.recurringTrigger(rule: rule, firstFire: at) { trigger = recurring }
        else {
            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
            trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        }
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }

    /// FREQ=WEEKLY;BYDAY=MO → weekly calendar trigger; FREQ=HOURLY;UNTILDONE=1 → repeating interval.
    private static func recurringTrigger(rule: String, firstFire: Date) -> UNNotificationTrigger? {
        let parts = Dictionary(uniqueKeysWithValues: rule.split(separator: ";").compactMap { kv -> (String, String)? in
            let p = kv.split(separator: "=", maxSplits: 1); return p.count == 2 ? (String(p[0]), String(p[1])) : nil
        })
        let cal = Calendar.current
        switch parts["FREQ"] {
        case "HOURLY":
            let hours = Double(parts["INTERVAL"] ?? "1") ?? 1
            return UNTimeIntervalNotificationTrigger(timeInterval: max(3600, hours * 3600), repeats: true)
        case "DAILY":
            return UNCalendarNotificationTrigger(dateMatching: cal.dateComponents([.hour, .minute], from: firstFire), repeats: true)
        case "WEEKLY":
            var comps = cal.dateComponents([.hour, .minute, .weekday], from: firstFire)
            if let by = parts["BYDAY"]?.split(separator: ",").first {
                let map = ["SU": 1, "MO": 2, "TU": 3, "WE": 4, "TH": 5, "FR": 6, "SA": 7]
                if let wd = map[String(by)] { comps.weekday = wd }
            }
            return UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
        case "MONTHLY":
            return UNCalendarNotificationTrigger(dateMatching: cal.dateComponents([.day, .hour, .minute], from: firstFire), repeats: true)
        default:
            return nil
        }
    }

    func cancel(for taskId: UUID) {
        center.getPendingNotificationRequests { reqs in
            let ids = reqs.map(\.identifier).filter { $0.hasPrefix("task-\(taskId.uuidString)") }
            self.center.removePendingNotificationRequests(withIdentifiers: ids)
        }
    }

    func scheduleDailyBriefing(at hhmm: String, enabled: Bool) {
        center.removePendingNotificationRequests(withIdentifiers: [AppConfig.briefingNotificationId])
        guard enabled else { return }
        let (h, m) = DateService.time(hhmm)
        let content = UNMutableNotificationContent()
        content.title = "Утренняя сводка"
        content.body = "Откройте, чтобы увидеть план на день"
        content.sound = .default
        let trigger = UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: h, minute: m), repeats: true)
        center.add(UNNotificationRequest(identifier: AppConfig.briefingNotificationId, content: content, trigger: trigger))
    }

    // MARK: delegate
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .sound, .list] }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let raw = response.notification.request.content.userInfo["taskId"] as? String, let id = UUID(uuidString: raw) else { return }
        switch response.actionIdentifier {
        case "DONE": NotificationCenter.default.post(name: .completeTaskFromNotification, object: id)
        case "SNOOZE": NotificationCenter.default.post(name: .snoozeTaskFromNotification, object: id)
        default: onOpenTask?(id)
        }
    }
}

extension Notification.Name {
    static let completeTaskFromNotification = Notification.Name("completeTaskFromNotification")
    static let snoozeTaskFromNotification = Notification.Name("snoozeTaskFromNotification")
    static let openTask = Notification.Name("openTask")
    static let startRecording = Notification.Name("startRecording")
}
