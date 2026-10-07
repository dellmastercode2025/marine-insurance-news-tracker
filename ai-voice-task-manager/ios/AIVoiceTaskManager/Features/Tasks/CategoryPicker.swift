import SwiftData
import SwiftUI

/// Project → Area picker that also allows typing a brand-new project/area name.
struct CategoryPicker: View {
    @Binding var projectId: UUID?
    @Binding var areaId: UUID?
    @Binding var newProjectName: String
    @Binding var newAreaName: String
    @Query(sort: \Project.name) private var projects: [Project]
    @Query(sort: \Area.name) private var areas: [Area]

    var body: some View {
        Picker("Проект", selection: $projectId) {
            Text("— новый / не выбран —").tag(UUID?.none)
            ForEach(projects.filter { !$0.isArchived }) { Text($0.name).tag(UUID?.some($0.id)) }
        }
        if projectId == nil { TextField("Название нового проекта", text: $newProjectName) }
        if let pid = projectId {
            Picker("Направление", selection: $areaId) {
                Text("— новое / не выбрано —").tag(UUID?.none)
                ForEach(areas.filter { $0.projectId == pid }) { Text($0.name).tag(UUID?.some($0.id)) }
            }
            if areaId == nil { TextField("Название нового направления", text: $newAreaName) }
        }
    }
}
