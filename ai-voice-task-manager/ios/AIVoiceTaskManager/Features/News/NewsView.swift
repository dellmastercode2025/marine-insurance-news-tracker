import SwiftUI

/// Insurance news: marine / aviation / Kazakhstan, refreshed on the backend every 30 min + AI digest.
struct NewsView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var topic = UserDefaults.standard.string(forKey: "news.topic") ?? "marine"
    @State private var data: NewsResponse?
    @State private var loading = false
    @State private var digestLoading = false
    @State private var error: String?
    @State private var filter = ""

    private let topics: [(String, String)] = [("marine", "Морское"), ("aviation", "Авиа"), ("kazakhstan", "Казахстан")]

    var body: some View {
        List {
            Section {
                Picker("Тема", selection: $topic) { ForEach(topics, id: \.0) { Text($0.1).tag($0.0) } }.pickerStyle(.segmented)
                HStack {
                    Label("AI-дайджест за сегодня", systemImage: "sparkles").font(.headline)
                    Spacer()
                    Button(digestLoading ? "…" : (data?.digest == nil ? "Сформировать" : "Обновить")) { Task { await load(refresh: data?.digest == nil, digest: true) } }.disabled(digestLoading)
                }
                if let d = data?.digest { Text(markdown(d)).font(.subheadline) }
                else { Text("Краткая выжимка главных событий с выводами для судовладельца в Казахстане.").font(.caption).foregroundStyle(.secondary) }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            ForEach(grouped, id: \.0) { day, items in
                Section(day) {
                    ForEach(items) { it in
                        Link(destination: URL(string: it.url) ?? URL(string: "https://news.google.com")!) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(it.title).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                                if let s = it.summary, !s.isEmpty { Text(s).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                                HStack { Chip(text: it.source); if let d = it.publishedAt { Text(d.formatted(date: .omitted, time: .shortened)).font(.caption2).foregroundStyle(.secondary) } }
                            }
                        }
                    }
                }
            }
            if let d = data, d.items.isEmpty, !loading { Text("Пока нет новостей. Потяните вниз, чтобы обновить.").foregroundStyle(.secondary) }
        }
        .searchable(text: $filter, prompt: "Фильтр")
        .navigationTitle("Новости")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { if loading { ProgressView() } else { Button { Task { await load(refresh: true) } } label: { Image(systemName: "arrow.clockwise") } } } }
        .refreshable { await load(refresh: true) }
        .task(id: topic) { UserDefaults.standard.set(topic, forKey: "news.topic"); await load() }
    }

    private var grouped: [(String, [NewsItem])] {
        let items = (data?.items ?? []).filter { filter.isEmpty || "\($0.title) \($0.summary ?? "") \($0.source)".localizedCaseInsensitiveContains(filter) }
        let groups = Dictionary(grouping: items) { $0.publishedAt.map { $0.formatted(.dateTime.weekday(.wide).day().month(.wide)) } ?? "Без даты" }
        return groups.sorted { ($0.value.first?.publishedAt ?? .distantPast) > ($1.value.first?.publishedAt ?? .distantPast) }
    }

    private func load(refresh: Bool = false, digest: Bool = false) async {
        if digest { digestLoading = true } else { loading = true }
        defer { loading = false; digestLoading = false }
        do { data = try await env.api.news(topic: topic, refresh: refresh, digest: digest); error = nil } catch { self.error = error.localizedDescription }
    }

    private func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }
}
