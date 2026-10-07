import SwiftUI

struct PriorityBadge: View {
    let priority: Priority
    var body: some View {
        Text(priority.short)
            .font(.caption2.bold())
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(priority.color.opacity(0.15), in: Capsule())
            .foregroundStyle(priority.color)
    }
}

struct Chip: View {
    let text: String
    var systemImage: String? = nil
    var tint: Color = .secondary
    var body: some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage) }
            Text(text)
        }
        .font(.caption)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(tint.opacity(0.12), in: Capsule())
        .foregroundStyle(tint)
    }
}

struct StatCard: View {
    let title: String
    let value: Int
    let tint: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(value)").font(.title2.bold()).foregroundStyle(tint)
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }
}

struct EmptyHint: View {
    let text: String
    var systemImage: String = "tray"
    var body: some View {
        ContentUnavailableView { Label(text, systemImage: systemImage) }
    }
}

struct TaskRowView: View {
    @Environment(AppEnvironment.self) private var env
    let task: TaskItem
    var showProject = true

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button { env.repo.complete(task, done: !task.isDone) } label: {
                Image(systemName: task.isDone ? "checkmark.circle.fill" : task.kind.symbol)
                    .font(.title3)
                    .foregroundStyle(task.isDone ? .green : task.priority.color)
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 4) {
                Text(task.title).strikethrough(task.isDone).lineLimit(2)
                HStack(spacing: 6) {
                    PriorityBadge(priority: task.priority)
                    if showProject, !env.repo.categoryPath(task).isEmpty { Text(env.repo.categoryPath(task)).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                HStack(spacing: 8) {
                    if let due = task.dueAt { Chip(text: DateService.relativeLabel(due), systemImage: "calendar", tint: task.isOverdue ? .red : .secondary) }
                    if let r = task.reminderAt, r > .now { Chip(text: r.formatted(date: .omitted, time: .shortened), systemImage: "bell", tint: .orange) }
                    if task.isWaiting, let p = env.repo.person(task.waitingForPersonId) { Chip(text: "Жду: \(p.name)", systemImage: "hourglass", tint: .purple) }
                    if task.sourceId != nil { Image(systemName: "waveform").font(.caption2).foregroundStyle(.secondary) }
                    if task.calendarEventId != nil { Image(systemName: "calendar.badge.checkmark").font(.caption2).foregroundStyle(.secondary) }
                }
                if !task.tags.isEmpty { Text(task.tags.map { "#\($0)" }.joined(separator: " ")).font(.caption2).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}
