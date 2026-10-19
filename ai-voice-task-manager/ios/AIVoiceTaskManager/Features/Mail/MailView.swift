import AuthenticationServices
import SwiftUI

/// «Переписки»: connected mailboxes and the AI-triaged list of emails still waiting for a reply.
struct MailView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var accounts: [MailAccount] = []
    @State private var messages: [MailMessage] = []
    @State private var view = 0 // 0 pending, 1 all, 2 handled
    @State private var loading = false
    @State private var error: String?
    @State private var open: MailMessage?
    @State private var showImap = false
    @State private var webSession: ASWebAuthenticationSession?

    private var pending: [MailMessage] { messages.filter { $0.needsReply && $0.replyStatus == "pending" } }
    private var handled: [MailMessage] { messages.filter { ["replied", "dismissed", "task_created"].contains($0.replyStatus) } }
    private var list: [MailMessage] { view == 0 ? pending : view == 2 ? handled : messages }

    var body: some View {
        List {
            Section("Почтовые ящики") {
                if accounts.isEmpty { Text("Подключите ящик — приложение читает входящие и отправленные (только чтение), находит письма без вашего ответа и показывает их здесь и в чате.").font(.caption).foregroundStyle(.secondary) }
                ForEach(accounts) { a in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack { Chip(text: a.provider == "gmail" ? "Gmail" : a.provider == "microsoft" ? "Microsoft 365" : "IMAP"); Text(a.email).font(.subheadline.bold()) }
                        Text(a.status == "error" ? "Ошибка: \(a.lastError ?? "")" : a.lastSyncAt.map { "Синхронизировано \(DateService.relativeLabel($0))" } ?? "Ещё не синхронизировано").font(.caption2).foregroundStyle(a.status == "error" ? .red : .secondary)
                    }
                    .swipeActions { Button(role: .destructive) { Task { try? await env.api.mailRemove(accountId: a.id); await load() } } label: { Label("Отключить", systemImage: "trash") } }
                }
                Menu {
                    Button("Gmail / Google Workspace") { Task { await connect("gmail") } }
                    Button("Microsoft 365 / Outlook") { Task { await connect("microsoft") } }
                    Button("IMAP (другой сервер)") { showImap = true }
                } label: { Label("Подключить почту", systemImage: "plus") }
                if !accounts.isEmpty { Button { Task { await sync() } } label: { Label(loading ? "Синхронизирую…" : "Проверить почту", systemImage: "arrow.clockwise") }.disabled(loading) }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            Section {
                Picker("", selection: $view) { Text("Без ответа (\(pending.count))").tag(0); Text("Все").tag(1); Text("Обработанные").tag(2) }.pickerStyle(.segmented)
                if list.isEmpty { Text(view == 0 ? (accounts.isEmpty ? "Подключите почту" : "Писем без ответа нет 🎉") : "Пусто").foregroundStyle(.secondary) }
                ForEach(list) { m in
                    Button { open = m } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(m.isFromMe ? "Я → \(m.toEmails.first ?? "")" : (m.fromName ?? m.fromEmail ?? "")).font(.caption.bold()).lineLimit(1)
                                if let p = m.aiPriority, m.replyStatus == "pending" { PriorityBadge(priority: Priority(rawValue: p) ?? .p3) }
                                if m.replyStatus == "pending" { Chip(text: "ждёт \(days(m)) дн.", tint: .red) }
                                if m.replyStatus == "task_created" { Chip(text: "задача", tint: .green) }
                                Spacer()
                                Text(m.receivedAt.formatted(date: .abbreviated, time: .shortened)).font(.caption2).foregroundStyle(.secondary)
                            }
                            Text(m.subject ?? "(без темы)").font(.subheadline).foregroundStyle(.primary)
                            if let a = m.aiSuggestedAction, m.replyStatus == "pending" { Text("→ \(a)").font(.caption).foregroundStyle(.orange) }
                            else if let s = m.snippet { Text(s).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                        }
                    }
                }
            }
        }
        .navigationTitle("Переписки")
        .refreshable { await sync() }
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .mailConnected)) { _ in Task { await sync() } }
        .sheet(item: $open) { m in NavigationStack { MailDetailView(message: m, thread: messages.filter { $0.threadId == m.threadId && $0.id != m.id }) { await load() } } }
        .sheet(isPresented: $showImap) { NavigationStack { ImapConnectView { showImap = false; Task { await sync() } } } }
    }

    private func days(_ m: MailMessage) -> Int { Int(Date().timeIntervalSince(m.receivedAt) / 86400) }

    private func load() async {
        do {
            let dec = ISO8601.decoder()
            let a = try await env.client.select("mail_accounts", query: [URLQueryItem(name: "select", value: "id,provider,email,display_name,status,last_sync_at,last_error"), URLQueryItem(name: "order", value: "created_at")])
            accounts = try dec.decode([MailAccount].self, from: a)
            let m = try await env.client.select("mail_messages", query: [URLQueryItem(name: "select", value: "id,account_id,thread_id,subject,from_name,from_email,to_emails,cc_emails,snippet,body_text,received_at,is_from_me,has_attachments,web_link,needs_reply,reply_status,ai_reason,ai_priority,ai_suggested_action,linked_task_id"), URLQueryItem(name: "order", value: "received_at.desc"), URLQueryItem(name: "limit", value: "400")])
            messages = try dec.decode([MailMessage].self, from: m)
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func sync() async {
        loading = true; defer { loading = false }
        do { let r = try await env.api.mailSync(); let errs = r.accounts.flatMap(\.errors); error = errs.isEmpty ? nil : errs.joined(separator: "; ") } catch { self.error = error.localizedDescription }
        await load()
    }

    private func connect(_ provider: String) async {
        do {
            let url = try await env.api.mailOAuthURL(provider: provider)
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: AppConfig.urlScheme) { cb, _ in
                if let cb { Task { @MainActor in env.handle(url: cb) } }
            }
            session.presentationContextProvider = PresentationAnchorProvider.shared
            webSession = session
            session.start()
        } catch { self.error = error.localizedDescription }
    }
}

struct MailDetailView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    let message: MailMessage
    let thread: [MailMessage]
    var onChange: () async -> Void

    var body: some View {
        List {
            Section {
                Text(message.subject ?? "(без темы)").font(.headline)
                Text("От: \(message.fromName ?? "") <\(message.fromEmail ?? "")>\n\(DateService.absoluteLabel(message.receivedAt))").font(.caption).foregroundStyle(.secondary)
                if let r = message.aiReason { Label(r, systemImage: "sparkles").font(.caption) }
                if let a = message.aiSuggestedAction { Text("→ \(a)").font(.caption).foregroundStyle(.orange) }
            }
            Section { Text(message.bodyText ?? message.snippet ?? "").font(.subheadline).textSelection(.enabled) }
            Section {
                if let link = message.webLink, let url = URL(string: link) { Link(destination: url) { Label("Открыть в почте", systemImage: "arrow.up.right.square") } }
                Button { Task { await createTask() } } label: { Label("Создать задачу", systemImage: "checkmark.circle") }
                Button { Task { await setStatus("replied") } } label: { Label("Я ответил", systemImage: "arrowshape.turn.up.left") }
                Button { Task { await setStatus("dismissed") } } label: { Label("Ответ не нужен", systemImage: "xmark.circle") }
            }
            if !thread.isEmpty {
                Section("Вся переписка") { ForEach(thread) { m in VStack(alignment: .leading) { Text("\(m.isFromMe ? "Я" : (m.fromName ?? m.fromEmail ?? "")) · \(DateService.absoluteLabel(m.receivedAt))").font(.caption2).foregroundStyle(.secondary); Text(m.snippet ?? "").font(.caption) } } }
            }
        }
        .navigationTitle("Письмо").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
    }

    private func setStatus(_ status: String, taskId: UUID? = nil) async {
        var patch: [String: Any] = ["reply_status": status, "needs_reply": false]
        if let taskId { patch["linked_task_id"] = taskId.uuidString.lowercased() }
        if let id = UUID(uuidString: message.id), let data = try? JSONSerialization.data(withJSONObject: patch) { try? await env.client.update("mail_messages", id: id, patch: data) }
        await onChange(); dismiss()
    }

    private func createTask() async {
        let t = env.repo.create(title: "Ответить: \(message.subject ?? message.fromName ?? "письмо")", priority: Priority(rawValue: message.aiPriority ?? 2) ?? .p2,
                                dueAt: Date().addingTimeInterval(86400), description: ["Письмо от \(message.fromName ?? "") <\(message.fromEmail ?? "")>", message.aiSuggestedAction, message.webLink].compactMap { $0 }.joined(separator: "\n"))
        t.tags = ["email"]; env.repo.save(t)
        await setStatus("task_created", taskId: t.id)
        env.openTaskId = t.id
    }
}

struct ImapConnectView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    var onDone: () -> Void
    @State private var email = ""; @State private var host = ""; @State private var port = "993"; @State private var username = ""; @State private var password = ""; @State private var secure = true
    @State private var busy = false; @State private var error: String?
    var body: some View {
        Form {
            Section(footer: Text("Для корпоративной почты с включённым IMAP. Пароль хранится зашифрованным на сервере. Для Microsoft 365 используйте вход через Microsoft.")) {
                TextField("Email", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                TextField("IMAP-сервер (mail.kmg.kz)", text: $host).textInputAutocapitalization(.never)
                TextField("Порт", text: $port).keyboardType(.numberPad)
                TextField("Логин", text: $username).textInputAutocapitalization(.never)
                SecureField("Пароль / пароль приложения", text: $password)
                Toggle("SSL/TLS", isOn: $secure)
            }
            if let error { Text(error).foregroundStyle(.red).font(.caption) }
        }
        .navigationTitle("IMAP")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button(busy ? "…" : "Подключить") {
                    Task { busy = true; defer { busy = false }
                        do { try await env.api.mailConnectIMAP(email: email, host: host, port: Int(port) ?? 993, secure: secure, username: username.isEmpty ? email : username, password: password); onDone(); dismiss() }
                        catch { self.error = error.localizedDescription } }
                }.disabled(busy || email.isEmpty || host.isEmpty || password.isEmpty)
            }
        }
    }
}
