import Foundation
import Observation
import SwiftData

/// Drives the pipeline of spec §27 for one VoiceEntry: audio → transcribe → parse → review → commit.
/// Entries recorded offline stay in `waiting_for_processing` and are processed when the network returns (§36).
@MainActor
@Observable
final class VoiceProcessingCoordinator {
    enum Stage: Equatable { case idle, transcribing, parsing, review, committing, failed(String) }

    private(set) var stage: Stage = .idle
    private(set) var proposal: ParseResponse?
    private(set) var activeEntry: VoiceEntry?

    private let api: APIService
    private let repo: TaskRepository
    private let network: NetworkMonitor

    init(api: APIService, repo: TaskRepository, network: NetworkMonitor) {
        self.api = api; self.repo = repo; self.network = network
    }

    /// Creates the VoiceEntry for a finished recording and starts processing if online.
    func enqueue(fileURL: URL, duration: TimeInterval, liveTranscript: String?) -> VoiceEntry {
        let entry = VoiceEntry(audioFileName: fileURL.lastPathComponent, durationSec: duration, liveTranscript: liveTranscript?.isEmpty == false ? liveTranscript : nil)
        repo.context.insert(entry)
        repo.upsertVoiceEntry(entry)
        if network.isOnline { Task { await process(entry) } }
        return entry
    }

    /// Text input path (Smart Inbox / quick add via text) – skips transcription.
    func enqueue(text: String) -> VoiceEntry {
        let entry = VoiceEntry(audioFileName: nil, durationSec: 0)
        entry.originalTranscript = text
        entry.cleanTranscript = text
        entry.processingStatus = .transcribed
        repo.context.insert(entry)
        repo.upsertVoiceEntry(entry)
        if network.isOnline { Task { await process(entry) } }
        return entry
    }

    func process(_ entry: VoiceEntry) async {
        activeEntry = entry
        proposal = nil
        do {
            if entry.cleanTranscript == nil {
                stage = .transcribing
                guard let name = entry.audioFileName else { throw ProcessingError.noAudio }
                let url = AudioRecorder.audioDirectory.appendingPathComponent(name)
                let data = try Data(contentsOf: url)
                let res = try await api.transcribe(audio: data, mimeType: AudioRecorder.mimeType(for: url), voiceEntryId: entry.id, languageHint: repo.prefs.language, liveTranscript: entry.liveTranscript)
                entry.language = res.language
                entry.originalTranscript = res.originalTranscript
                entry.cleanTranscript = res.cleanTranscript
                entry.processingStatus = .transcribed
                repo.upsertVoiceEntry(entry)
                if repo.prefs.deleteAudioAfterTranscription || repo.prefs.privateMode { deleteAudio(entry) }
            }
            stage = .parsing
            let parsed = try await api.parse(transcript: entry.cleanTranscript ?? "", originalTranscript: entry.originalTranscript, voiceEntryId: entry.id)
            entry.aiSummary = parsed.summary
            entry.extractionJSON = try? JSONEncoder().encode(parsed)
            entry.processingStatus = .parsed
            repo.upsertVoiceEntry(entry)
            proposal = parsed
            stage = .review
        } catch SupabaseError.offline {
            stage = .idle // stays waiting_for_processing
        } catch {
            entry.processingStatus = .failed
            entry.lastError = error.localizedDescription
            repo.upsertVoiceEntry(entry)
            stage = .failed(error.localizedDescription)
        }
    }

    /// Reopen the saved proposal for an entry that was parsed but not yet confirmed.
    func resumeReview(_ entry: VoiceEntry) {
        guard let data = entry.extractionJSON, let p = try? JSONDecoder().decode(ParseResponse.self, from: data) else { Task { await process(entry) }; return }
        activeEntry = entry; proposal = p; stage = .review
    }

    func commit(items: [ResolvedItem]) async throws -> CommitResponse {
        guard let entry = activeEntry else { throw ProcessingError.noEntry }
        stage = .committing
        do {
            let res = try await api.commit(items: items, voiceEntryId: entry.id, originalTranscript: entry.originalTranscript, cleanTranscript: entry.cleanTranscript)
            repo.ingest(serverTasks: res.tasks)
            entry.processingStatus = .committed
            entry.extractionJSON = nil
            repo.upsertVoiceEntry(entry)
            UndoService.shared.remember(serverBatchId: res.batchId, summary: "Добавлено \(res.tasks.count) элементов")
            stage = .idle
            proposal = nil
            activeEntry = nil
            return res
        } catch {
            stage = .review
            throw error
        }
    }

    func discard() {
        if let entry = activeEntry { entry.processingStatus = .discarded; entry.extractionJSON = nil; repo.upsertVoiceEntry(entry); deleteAudio(entry) }
        stage = .idle; proposal = nil; activeEntry = nil
    }

    func reset() { stage = .idle; proposal = nil; activeEntry = nil }

    /// Called when the network returns or the app comes to the foreground.
    func processPending() async {
        guard network.isOnline else { return }
        let waiting = ProcessingStatus.waitingForProcessing.rawValue
        let pending = (try? repo.context.fetch(FetchDescriptor<VoiceEntry>(predicate: #Predicate { $0.processingStatusRaw == waiting }, sortBy: [SortDescriptor(\.createdAt)]))) ?? []
        for entry in pending where stage == .idle { await process(entry) }
    }

    func deleteAudio(_ entry: VoiceEntry) {
        if let name = entry.audioFileName { try? FileManager.default.removeItem(at: AudioRecorder.audioDirectory.appendingPathComponent(name)) }
        entry.audioFileName = nil
    }

    enum ProcessingError: LocalizedError {
        case noAudio, noEntry
        var errorDescription: String? { self == .noAudio ? "Аудиофайл не найден" : "Нет активной записи" }
    }
}
