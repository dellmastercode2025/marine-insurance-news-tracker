import Foundation
import Network
import Observation

@Observable
final class NetworkMonitor {
    private(set) var isOnline = true
    private let monitor = NWPathMonitor()
    var onBecameOnline: (() -> Void)?

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let was = self.isOnline
                self.isOnline = path.status == .satisfied
                if !was && self.isOnline { self.onBecameOnline?() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "network.monitor"))
    }
}
