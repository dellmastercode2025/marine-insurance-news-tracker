import Foundation
import LocalAuthentication
import Observation

/// Face ID / passcode lock (spec §34).
@Observable
final class AppLock {
    var isLocked = false
    var isEnabled: Bool { UserDefaults.standard.bool(forKey: "appLock.enabled") }

    func setEnabled(_ on: Bool) { UserDefaults.standard.set(on, forKey: "appLock.enabled"); if !on { isLocked = false } }

    func lockIfNeeded() { if isEnabled { isLocked = true } }

    func unlock() async {
        guard isEnabled else { isLocked = false; return }
        let ctx = LAContext()
        ctx.localizedCancelTitle = "Отмена"
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else { isLocked = false; return }
        do {
            let ok = try await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Разблокировать задачи")
            isLocked = !ok
        } catch { isLocked = true }
    }
}
