import SwiftUI

/// Today | Board | 🎙 | Chat | Projects (spec §22). The microphone is an overlaid prominent button.
struct RootTabView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        @Bindable var env = env
        ZStack(alignment: .bottom) {
            TabView(selection: $env.selectedTab) {
                TodayView().tabItem { Label("Сегодня", systemImage: "sun.max") }.tag(AppEnvironment.Tab.today)
                BoardView().tabItem { Label("Доска", systemImage: "square.grid.3x1.below.line.grid.1x2") }.tag(AppEnvironment.Tab.board)
                ChatView().tabItem { Label("Чат", systemImage: "bubble.left.and.text.bubble.right") }.tag(AppEnvironment.Tab.chat)
                ProjectsView().tabItem { Label("Проекты", systemImage: "folder") }.tag(AppEnvironment.Tab.projects)
                MoreView().tabItem { Label("Ещё", systemImage: "ellipsis.circle") }.tag(AppEnvironment.Tab.more)
            }
            MicButton { env.showRecorder = true }
                .padding(.bottom, 4)
            UndoBanner().padding(.bottom, 90)
        }
        .fullScreenCover(isPresented: $env.showRecorder) { VoiceCaptureView() }
        .sheet(item: Binding(get: { env.openTaskId.map { IdentifiedUUID(id: $0) } }, set: { env.openTaskId = $0?.id })) { wrapper in
            if let task = env.repo.task(wrapper.id) { NavigationStack { TaskDetailView(task: task) } } else { Text("Задача не найдена").padding() }
        }
    }
}

struct IdentifiedUUID: Identifiable { let id: UUID }

struct MicButton: View {
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "mic.fill")
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(Circle().fill(LinearGradient(colors: [.red, .orange], startPoint: .topLeading, endPoint: .bottomTrailing)))
                .shadow(color: .red.opacity(0.35), radius: 10, y: 4)
        }
        .accessibilityLabel("Записать голосовое поручение")
    }
}

struct UndoBanner: View {
    private var undo: UndoService { UndoService.shared }
    var body: some View {
        if let entry = undo.current {
            HStack {
                Text(entry.summary).font(.subheadline).lineLimit(2)
                Spacer()
                Button("UNDO") { Task { await undo.undo() } }.font(.subheadline.bold())
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
