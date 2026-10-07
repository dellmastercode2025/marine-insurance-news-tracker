import SwiftUI

/// Voice Inbox (spec §4.1): record → waveform + live transcript → AI → review → confirm.
struct VoiceCaptureView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @State private var recorder = AudioRecorder()
    @State private var live = LiveTranscriber()
    @State private var permissionDenied = false
    @State private var textMode = false
    @State private var typed = ""

    var body: some View {
        NavigationStack {
            Group {
                switch env.voice.stage {
                case .idle: recordingScreen
                case .transcribing: processing("Расшифровываю запись…")
                case .parsing: processing("Выделяю задачи, сроки и проекты…")
                case .review, .committing:
                    if let p = env.voice.proposal { ExtractionReviewView(proposal: p) { dismiss() } }
                case .failed(let msg): failure(msg)
                }
            }
            .navigationTitle("Голосовое поручение")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { if recorder.isRecording { recorder.cancel(); live.stop() }; env.voice.reset(); dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) { if env.voice.stage == .idle { Button { textMode.toggle() } label: { Image(systemName: textMode ? "mic" : "keyboard") } } }
            }
        }
        .task {
            let mic = await AudioRecorder.requestPermission()
            _ = await LiveTranscriber.requestPermission()
            permissionDenied = !mic
            recorder.onBuffer = { [live] buffer in live.append(buffer) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .startRecording)) { _ in if !recorder.isRecording, env.voice.stage == .idle { start() } }
        .interactiveDismissDisabled(recorder.isRecording)
    }

    private var recordingScreen: some View {
        VStack(spacing: 24) {
            if !env.network.isOnline { Label("Офлайн: запись сохранится и будет обработана при появлении сети", systemImage: "wifi.slash").font(.footnote).foregroundStyle(.orange).padding(.horizontal) }
            if textMode {
                TextEditor(text: $typed).frame(minHeight: 160).padding(8).background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12)).padding(.horizontal)
                Button("Разобрать текст") { _ = env.voice.enqueue(text: typed); typed = "" }.buttonStyle(.borderedProminent).disabled(typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Spacer()
            } else {
                Spacer()
                WaveformView(levels: recorder.levels, active: recorder.isRecording).frame(height: 90).padding(.horizontal)
                Text(recorder.isRecording ? format(recorder.elapsed) : "Нажмите и говорите свободно: несколько тем, сроки, имена — всё будет разложено автоматически.")
                    .font(recorder.isRecording ? .title.monospacedDigit() : .subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal)
                ScrollView { Text(live.text.isEmpty ? " " : live.text).font(.body).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal) }.frame(maxHeight: 180)
                Spacer()
                Button { recorder.isRecording ? stop() : start() } label: {
                    ZStack {
                        Circle().fill(recorder.isRecording ? Color.red : Color.red.opacity(0.9)).frame(width: 96, height: 96)
                        if recorder.isRecording { RoundedRectangle(cornerRadius: 6).fill(.white).frame(width: 32, height: 32) }
                        else { Image(systemName: "mic.fill").font(.system(size: 40)).foregroundStyle(.white) }
                    }
                }
                .disabled(permissionDenied)
                .padding(.bottom, 24)
                if permissionDenied { Text("Нет доступа к микрофону. Разрешите в Настройках.").font(.footnote).foregroundStyle(.red) }
            }
        }
        .padding(.top)
    }

    private func processing(_ text: String) -> some View {
        VStack(spacing: 16) { ProgressView().controlSize(.large); Text(text).foregroundStyle(.secondary) }
    }

    private func failure(_ msg: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(.orange)
            Text("Не удалось обработать запись").font(.headline)
            Text(msg).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal)
            HStack {
                Button("Повторить") { if let e = env.voice.activeEntry { Task { await env.voice.process(e) } } }.buttonStyle(.borderedProminent)
                Button("Позже") { env.voice.reset(); dismiss() }.buttonStyle(.bordered)
            }
            Text("Запись сохранена в Inbox и будет обработана повторно.").font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func start() {
        do {
            live.start(locale: Locale(identifier: env.repo.prefs.language == "en" ? "en-US" : env.repo.prefs.language == "kk" ? "kk-KZ" : "ru-RU"))
            try recorder.start()
        } catch { permissionDenied = true }
    }

    private func stop() {
        live.stop()
        guard let (url, duration) = recorder.stop() else { return }
        guard duration > 0.7 else { try? FileManager.default.removeItem(at: url); return }
        _ = env.voice.enqueue(fileURL: url, duration: duration, liveTranscript: live.text)
        if !env.network.isOnline { dismiss() }
    }

    private func format(_ t: TimeInterval) -> String { String(format: "%02d:%02d", Int(t) / 60, Int(t) % 60) }
}

struct WaveformView: View {
    let levels: [Float]
    let active: Bool
    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .center, spacing: 3) {
                ForEach(Array(levels.enumerated()), id: \.offset) { _, level in
                    Capsule().fill(active ? Color.red : Color.secondary.opacity(0.4))
                        .frame(width: max(2, (geo.size.width / CGFloat(levels.count)) - 3), height: max(4, CGFloat(level) * geo.size.height))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.linear(duration: 0.15), value: levels)
        }
    }
}
