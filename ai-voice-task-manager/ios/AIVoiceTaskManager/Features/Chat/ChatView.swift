import SwiftData
import SwiftUI

/// AI chat with tool access (spec §16). Pending actions (bulk, delete, calendar) require explicit confirmation (§39).
struct ChatView: View {
    @Environment(AppEnvironment.self) private var env
    @Query(sort: \ChatMessage.createdAt) private var messages: [ChatMessage]
    @State private var input = ""
    @State private var sending = false
    @State private var conversationId: UUID = {
        if let s = UserDefaults.standard.string(forKey: "chat.conversation"), let id = UUID(uuidString: s) { return id }
        let id = UUID(); UserDefaults.standard.set(id.uuidString, forKey: "chat.conversation"); return id
    }()

    private let suggestions = ["Что у меня сегодня?", "Что просрочено по Казмортрансфлоту?", "Что я жду от Дениса?", "Что самое срочное на этой неделе?", "Перенеси всё несрочное с сегодня на пятницу"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            if messages.isEmpty {
                                Text("Спросите о задачах или попросите что-то изменить. AI видит только вашу базу и действует через разрешённые функции.").font(.footnote).foregroundStyle(.secondary).padding()
                                ForEach(suggestions, id: \.self) { s in Button(s) { input = s; Task { await send() } }.buttonStyle(.bordered).font(.subheadline) }
                            }
                            ForEach(messages.filter { $0.conversationId == conversationId }) { m in MessageBubble(message: m, onConfirm: confirm).id(m.id) }
                            if sending { HStack { ProgressView(); Text("Думаю…").font(.caption).foregroundStyle(.secondary) }.padding(.horizontal) }
                        }
                        .padding(.vertical)
                        .padding(.bottom, 70)
                    }
                    .onChange(of: messages.count) { _, _ in if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } } }
                }
                HStack {
                    TextField("Сообщение…", text: $input, axis: .vertical).lineLimit(1...4).textFieldStyle(.roundedBorder)
                    Button { Task { await send() } } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }.disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || sending)
                }
                .padding(.horizontal).padding(.bottom, 84)
            }
            .navigationTitle("Чат")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Новый диалог") { conversationId = UUID(); UserDefaults.standard.set(conversationId.uuidString, forKey: "chat.conversation") } } }
        }
    }

    private func send() async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        input = ""; sending = true; defer { sending = false }
        let ctx = env.repo.context
        ctx.insert(ChatMessage(conversationId: conversationId, role: "user", content: text))
        let history = messages.filter { $0.conversationId == conversationId }.suffix(12).map { (role: $0.role, content: $0.content) }
        do {
            let res = try await env.api.chat(message: text, history: history, conversationId: conversationId)
            let pending = res.pendingActions.isEmpty ? nil : try? JSONEncoder().encode(res.pendingActions)
            ctx.insert(ChatMessage(conversationId: conversationId, role: "assistant", content: res.reply, pendingActionsJSON: pending, batchId: res.batchId.flatMap(UUID.init(uuidString:))))
            if let b = res.batchId, !res.executed.isEmpty { UndoService.shared.remember(serverBatchId: b, summary: "Выполнено: \(res.executed.map(\.name).joined(separator: ", "))") }
            if !res.executed.isEmpty { await env.sync.syncNow(); env.repo.rearmAllNotifications() }
        } catch {
            ctx.insert(ChatMessage(conversationId: conversationId, role: "assistant", content: "Ошибка: \(error.localizedDescription)"))
        }
        try? ctx.save()
    }

    private func confirm(_ message: ChatMessage, _ actions: [PendingAction]) async {
        do {
            let res = try await env.api.executeActions(actions, description: actions.map(\.description).joined(separator: "; "))
            message.pendingActionsJSON = nil
            let ok = res.results.filter(\.ok).count
            env.repo.context.insert(ChatMessage(conversationId: conversationId, role: "assistant", content: ok == actions.count ? "Готово: \(actions.map(\.description).joined(separator: "; "))" : "Выполнено \(ok) из \(actions.count). " + res.results.compactMap(\.error).joined(separator: "; ")))
            UndoService.shared.remember(serverBatchId: res.batchId, summary: actions.first?.description ?? "Действие выполнено")
            await env.sync.syncNow(); env.repo.rearmAllNotifications()
        } catch {
            env.repo.context.insert(ChatMessage(conversationId: conversationId, role: "assistant", content: "Не удалось выполнить: \(error.localizedDescription)"))
        }
        try? env.repo.context.save()
    }
}

struct MessageBubble: View {
    let message: ChatMessage
    var onConfirm: (ChatMessage, [PendingAction]) async -> Void
    @State private var busy = false

    private var pending: [PendingAction] { message.pendingActionsJSON.flatMap { try? JSONDecoder().decode([PendingAction].self, from: $0) } ?? [] }

    var body: some View {
        VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 8) {
            Text(LocalizedStringKey(message.content))
                .padding(12)
                .background(message.role == "user" ? Color.accentColor.opacity(0.15) : Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
            if !pending.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Требуется подтверждение", systemImage: "hand.raised").font(.caption.bold()).foregroundStyle(.orange)
                    ForEach(pending) { a in Text("• \(a.description)").font(.subheadline) }
                    HStack {
                        Button("Подтвердить") { busy = true; Task { await onConfirm(message, pending); busy = false } }.buttonStyle(.borderedProminent).disabled(busy)
                        Button("Отклонить") { message.pendingActionsJSON = nil }.buttonStyle(.bordered)
                    }
                }
                .padding(12)
                .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
        .padding(.horizontal)
    }
}
