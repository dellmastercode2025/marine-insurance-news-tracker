import AuthenticationServices
import CryptoKit
import SwiftUI

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
