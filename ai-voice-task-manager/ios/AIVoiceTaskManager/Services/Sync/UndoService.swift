import Foundation
import Observation

/// Every bulk / AI action is undoable (spec §38). Server batches undo through /undo; local-only
/// batches keep a restore closure.
@MainActor
@Observable
final class UndoService {
    static let shared = UndoService()

    struct Entry: Identifiable {
        let id: UUID
        let summary: String
        let serverBatchId: String?
        let restore: (() -> Void)?
        let createdAt = Date()
    }

    private(set) var current: Entry?
    var api: APIService?
    var afterUndo: (() -> Void)?

    func remember(serverBatchId: String, summary: String) {
        current = Entry(id: UUID(), summary: summary, serverBatchId: serverBatchId, restore: nil)
        autoDismiss()
    }

    func remember(local batch: ActionBatchRecord, restore: @escaping () -> Void) {
        current = Entry(id: batch.id, summary: batch.summary, serverBatchId: nil, restore: restore)
        autoDismiss()
    }

    func undo() async {
        guard let e = current else { return }
        current = nil
        if let id = e.serverBatchId, let api { _ = try? await api.undo(batchId: id) }
        e.restore?()
        afterUndo?()
    }

    func dismiss() { current = nil }

    private func autoDismiss() {
        let id = current?.id
        Task { try? await Task.sleep(for: .seconds(12)); if current?.id == id { current = nil } }
    }
}
