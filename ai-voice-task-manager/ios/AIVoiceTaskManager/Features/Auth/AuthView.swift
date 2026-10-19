import AuthenticationServices
import CryptoKit
import SwiftUI
import UIKit

struct AuthView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var email = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var error: String?
    @State private var nonce = ""
    @State private var busy = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "waveform.circle.fill").font(.system(size: 72)).foregroundStyle(.red)
            Text("AI Voice Task Manager").font(.title.bold())
            Text("Говорите — приложение само разложит всё по задачам, проектам и срокам.").multilineTextAlignment(.center).foregroundStyle(.secondary).padding(.horizontal)

            SignInWithAppleButton(.signIn) { request in
                nonce = Self.randomNonce()
                request.requestedScopes = [.email, .fullName]
                request.nonce = Self.sha256(nonce)
            } onCompletion: { result in
                Task { await handleApple(result) }
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 50).padding(.horizontal)

            Button { Task { await signInWithGoogle() } } label: {
                HStack { Image(systemName: "g.circle.fill"); Text("Войти через Google").bold() }.frame(maxWidth: .infinity).frame(height: 44)
            }
            .buttonStyle(.bordered).padding(.horizontal).disabled(busy)

            VStack(spacing: 10) {
                TextField("Email", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).textFieldStyle(.roundedBorder)
                if codeSent {
                    TextField("Код из письма", text: $code).keyboardType(.numberPad).textFieldStyle(.roundedBorder)
                    Button("Войти") { Task { await verify() } }.buttonStyle(.borderedProminent).disabled(code.count < 6 || busy)
                } else {
                    Button("Получить код на email") { Task { await sendCode() } }.buttonStyle(.bordered).disabled(!email.contains("@") || busy)
                }
            }
            .padding(.horizontal)
            if let error { Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center).padding(.horizontal) }
            Spacer()
            Text("Ключи AI хранятся только на сервере. Данные защищены TLS и шифрованием.").font(.caption2).foregroundStyle(.secondary)
        }
        .padding()
    }

    @State private var webSession: ASWebAuthenticationSession?
    private func signInWithGoogle() async {
        busy = true; defer { busy = false }
        let redirect = "\(AppConfig.urlScheme)://auth-callback"
        let (url, verifier) = await env.client.oauthURL(provider: "google", redirectTo: redirect)
        do {
            let callback: URL = try await withCheckedThrowingContinuation { cont in
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: AppConfig.urlScheme) { url, err in
                    if let url { cont.resume(returning: url) } else { cont.resume(throwing: err ?? URLError(.cancelled)) }
                }
                session.presentationContextProvider = PresentationAnchorProvider.shared
                session.prefersEphemeralWebBrowserSession = false
                webSession = session
                session.start()
            }
            guard let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value else { error = "Google не вернул код"; return }
            try await env.client.exchangeCode(code, verifier: verifier)
            await env.didSignIn()
        } catch { if (error as? URLError)?.code != .cancelled { self.error = error.localizedDescription } }
    }

    private func sendCode() async {
        busy = true; defer { busy = false }
        do { try await env.client.sendEmailOTP(email: email); codeSent = true; error = nil } catch { self.error = error.localizedDescription }
    }
    private func verify() async {
        busy = true; defer { busy = false }
        do { try await env.client.verifyEmailOTP(email: email, code: code); await env.didSignIn() } catch { self.error = error.localizedDescription }
    }
    private func handleApple(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .failure(let e): error = e.localizedDescription
        case .success(let auth):
            guard let cred = auth.credential as? ASAuthorizationAppleIDCredential, let tokenData = cred.identityToken, let token = String(data: tokenData, encoding: .utf8) else { error = "Apple не вернул токен"; return }
            do { try await env.client.signInWithApple(idToken: token, nonce: nonce); await env.didSignIn() } catch { self.error = error.localizedDescription }
        }
    }

    static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var bytes = [UInt8](repeating: 0, count: length)
        _ = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
        return String(bytes.map { charset[Int($0) % charset.count] })
    }
    static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

final class PresentationAnchorProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = PresentationAnchorProvider()
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }
}
