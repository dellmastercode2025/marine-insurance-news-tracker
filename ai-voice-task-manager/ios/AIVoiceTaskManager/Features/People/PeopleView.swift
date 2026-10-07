import SwiftData
import SwiftUI

struct PeopleView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Person.name) private var people: [Person]
    @Query(sort: \Organisation.name) private var orgs: [Organisation]
    @Query(filter: #Predicate<TaskItem> { $0.deletedAt == nil && $0.completedAt == nil }) private var open: [TaskItem]
    @State private var newName = ""

    var body: some View {
        List {
            Section("Люди") {
                ForEach(people) { p in
                    NavigationLink {
                        List {
                            Section("Жду от \(p.name)") { ForEach(open.filter { $0.waitingForPersonId == p.id }) { t in NavigationLink { TaskDetailView(task: t) } label: { TaskRowView(task: t) } } }
                            Section("Связанные задачи") { ForEach(open.filter { $0.personId == p.id }) { t in NavigationLink { TaskDetailView(task: t) } label: { TaskRowView(task: t) } } }
                        }.navigationTitle(p.name)
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(p.name)
                                Text([p.role, orgs.first { $0.id == p.organisationId }?.name].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            let n = open.filter { $0.waitingForPersonId == p.id }.count
                            if n > 0 { Chip(text: "жду \(n)", systemImage: "hourglass", tint: .purple) }
                        }
                    }
                }
                HStack { TextField("Новый контакт", text: $newName); Button("Добавить") { env.repo.createPerson(name: newName, role: nil, organisationId: nil); newName = "" }.disabled(newName.isEmpty) }
            }
            Section("Организации") { ForEach(orgs) { Text($0.name) } }
        }
        .navigationTitle("Люди")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
    }
}
