import AVFoundation
import Foundation
import Observation
import Speech

/// On-device realtime transcription shown while recording (spec §4.1 step 3). The final transcript
/// comes from the backend (Gemini) which handles mixed RU/EN/KK speech far better; the live text
/// is only a hint.
@Observable
final class LiveTranscriber {
    private(set) var text: String = ""
    private(set) var isAvailable = false
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    static func requestPermission() async -> Bool {
        await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0 == .authorized) }
        }
    }

    func start(locale: Locale = Locale(identifier: "ru-RU")) {
        recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer()
        guard let recognizer, recognizer.isAvailable else { isAvailable = false; return }
        isAvailable = true
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.taskHint = .dictation
        if #available(iOS 16, *) { req.addsPunctuation = true }
        request = req
        text = ""
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result { Task { @MainActor in self.text = result.bestTranscription.formattedString } }
            if error != nil || (result?.isFinal ?? false) { self.task = nil }
        }
    }

    func append(_ buffer: AVAudioPCMBuffer) { request?.append(buffer) }

    func stop() {
        request?.endAudio()
        task?.finish()
        task = nil
        request = nil
    }
}
