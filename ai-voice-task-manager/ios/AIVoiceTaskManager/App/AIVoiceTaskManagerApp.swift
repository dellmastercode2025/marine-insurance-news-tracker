import SwiftData
import SwiftUI

@main
struct AIVoiceTaskManagerApp: App {
    @State private var env = AppEnvironment.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(env)
                .modelContainer(env.container)
                .task { await env.bootstrap() }
                .onOpenURL { env.handle(url: $0) }
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .active:
                        Task { await env.appLock.unlock(); await env.sync.syncNow(); await env.voice.processPending() }
                    case .background:
                        env.appLock.lockIfNeeded()
                    default: break
                    }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        ZStack {
            if env.isAuthenticated { RootTabView() } else { AuthView() }
            if env.appLock.isLocked { LockScreen() }
        }
        .animation(.default, value: env.isAuthenticated)
    }
}

struct LockScreen: View {
    @Environment(AppEnvironment.self) private var env
    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "lock.fill").font(.system(size: 48))
                Text("Заблокировано").font(.title2.bold())
                Button("Разблокировать") { Task { await env.appLock.unlock() } }.buttonStyle(.borderedProminent)
            }
        }
    }
}
