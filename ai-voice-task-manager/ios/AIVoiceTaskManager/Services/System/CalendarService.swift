import EventKit
import Foundation
import Observation

/// EventKit integration (spec §13): read events for the agenda, create/update events the app owns.
@Observable
final class CalendarService {
    private let store = EKEventStore()
    private(set) var hasAccess = false

    func requestAccess() async {
        hasAccess = (try? await store.requestFullAccessToEvents()) ?? false
    }

    func events(from: Date, to: Date) -> [EKEvent] {
        guard hasAccess else { return [] }
        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: nil)
        return store.events(matching: predicate).sorted { $0.startDate < $1.startDate }
    }

    /// Creates or updates the event linked to a task; returns the event identifier.
    @discardableResult
    func upsertEvent(for task: TaskItem, notes: String?) throws -> String? {
        guard hasAccess, let start = task.startAt ?? task.dueAt else { return nil }
        let event: EKEvent
        if let id = task.calendarEventId, let existing = store.event(withIdentifier: id) { event = existing }
        else { event = EKEvent(eventStore: store); event.calendar = store.defaultCalendarForNewEvents }
        event.title = task.title
        event.startDate = start
        event.endDate = task.eventEndAt ?? start.addingTimeInterval(3600)
        event.notes = notes
        event.url = URL(string: "\(AppConfig.urlScheme)://task/\(task.id.uuidString)")
        if event.alarms?.isEmpty ?? true { event.addAlarm(EKAlarm(relativeOffset: -900)) }
        try store.save(event, span: .thisEvent)
        return event.eventIdentifier
    }

    func removeEvent(id: String) {
        guard let e = store.event(withIdentifier: id) else { return }
        try? store.remove(e, span: .thisEvent)
    }

    func event(id: String) -> EKEvent? { store.event(withIdentifier: id) }
}

/// Optional Apple Reminders mirror (spec §14).
@Observable
final class RemindersService {
    private let store = EKEventStore()
    private(set) var hasAccess = false

    func requestAccess() async { hasAccess = (try? await store.requestFullAccessToReminders()) ?? false }

    func shouldMirror(_ task: TaskItem, mode: AppleRemindersSync) -> Bool {
        switch mode {
        case .off: false
        case .important: task.priority <= .p2
        case .withReminder: task.reminderAt != nil
        case .all: true
        }
    }

    @discardableResult
    func upsert(_ task: TaskItem) throws -> String? {
        guard hasAccess else { return nil }
        let reminder: EKReminder
        if let id = task.appleReminderId, let existing = store.calendarItem(withIdentifier: id) as? EKReminder { reminder = existing }
        else { reminder = EKReminder(eventStore: store); reminder.calendar = store.defaultCalendarForNewReminders() }
        reminder.title = task.title
        reminder.priority = task.priority == .p1 ? 1 : task.priority == .p2 ? 4 : task.priority == .p3 ? 5 : 9
        reminder.isCompleted = task.isDone
        if let due = task.dueAt { reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due) }
        reminder.alarms = nil
        if let at = task.reminderAt { reminder.addAlarm(EKAlarm(absoluteDate: at)) }
        try store.save(reminder, commit: true)
        return reminder.calendarItemIdentifier
    }

    func remove(id: String) {
        guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { return }
        try? store.remove(r, commit: true)
    }
}
