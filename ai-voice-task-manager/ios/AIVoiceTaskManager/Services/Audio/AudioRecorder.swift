import AVFoundation
import Foundation
import Observation

/// Records AAC (.m4a) with AVAudioEngine, publishes waveform levels and feeds the same buffers
/// to the live transcriber. Audio files live in Application Support/audio (excluded from backup).
@Observable
final class AudioRecorder: NSObject {
    private(set) var isRecording = false
    private(set) var levels: [Float] = Array(repeating: 0.02, count: 48)
    private(set) var elapsed: TimeInterval = 0
    private(set) var currentFileURL: URL?

    private let engine = AVAudioEngine()
    private var file: AVAudioFile?
    private var startedAt: Date?
    private var timer: Timer?
    var onBuffer: ((AVAudioPCMBuffer) -> Void)?

    static let audioDirectory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("audio", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var url = base; try? url.setResourceValues(values)
        return base
    }()

    static func requestPermission() async -> Bool {
        await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { cont.resume(returning: $0) }
        }
    }

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        let name = "\(UUID().uuidString.lowercased()).m4a"
        let url = Self.audioDirectory.appendingPathComponent(name)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        file = try AVAudioFile(forWriting: url, settings: settings)
        currentFileURL = url

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            try? self.file?.write(from: buffer)
            self.onBuffer?(buffer)
            let level = Self.rms(buffer)
            Task { @MainActor in self.push(level) }
        }
        engine.prepare()
        try engine.start()
        startedAt = .now
        isRecording = true
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            guard let self, let s = self.startedAt else { return }
            self.elapsed = Date().timeIntervalSince(s)
        }
    }

    /// Stops and returns (file, duration).
    func stop() -> (URL, TimeInterval)? {
        guard isRecording else { return nil }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        timer?.invalidate(); timer = nil
        isRecording = false
        let duration = startedAt.map { Date().timeIntervalSince($0) } ?? 0
        file = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        defer { currentFileURL = nil; levels = Array(repeating: 0.02, count: 48); elapsed = 0 }
        guard let url = currentFileURL else { return nil }
        return (url, duration)
    }

    func cancel() {
        if let (url, _) = stop() { try? FileManager.default.removeItem(at: url) }
    }

    @MainActor private func push(_ level: Float) {
        levels.removeFirst()
        levels.append(max(0.02, min(1, level * 4)))
    }

    private static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let ch = buffer.floatChannelData?[0] else { return 0 }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<n { sum += ch[i] * ch[i] }
        return sqrt(sum / Float(n))
    }

    static func mimeType(for url: URL) -> String { url.pathExtension.lowercased() == "wav" ? "audio/wav" : "audio/mp4" }
}
