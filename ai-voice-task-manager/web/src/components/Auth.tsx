import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin, queryParams: { access_type: "offline", prompt: "select_account" } } });
    if (error) { setError(error.message); setBusy(false); }
  };
  const sendCode = async () => {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) setError(error.message); else setSent(true);
  };
  const verify = async () => {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    setBusy(false);
    if (error) setError(error.message);
  };

  return (
    <div className="login">
      <div className="card">
        <div style={{ fontSize: 48 }}>🎙️</div>
        <h1>AI Voice Task Manager</h1>
        <p className="muted">Говорите — приложение само разложит всё по задачам, проектам и срокам. Один аккаунт для iPhone и компьютера.</p>
        <button className="gbtn" onClick={google} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg>
          Войти через Google
        </button>
        <div className="muted tiny">или по коду на email</div>
        <input placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        {sent ? (
          <>
            <input placeholder="Код из письма" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
            <button className="primary" onClick={verify} disabled={busy || code.length < 6}>Войти</button>
          </>
        ) : (
          <button onClick={sendCode} disabled={busy || !email.includes("@")}>Получить код</button>
        )}
        {error && <div className="error small">{error}</div>}
        <div className="tiny muted">Ключи AI хранятся только на сервере. Данные защищены TLS и политиками доступа.</div>
      </div>
    </div>
  );
}
