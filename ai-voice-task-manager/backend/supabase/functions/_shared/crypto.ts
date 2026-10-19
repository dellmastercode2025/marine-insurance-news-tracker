// AES-GCM encryption for mailbox credentials at rest. Key: MAIL_ENCRYPTION_KEY (base64, 32 bytes).
// Falls back to a key derived from the service role key so the feature works out of the box;
// set MAIL_ENCRYPTION_KEY explicitly in production (see docs/MAIL_AND_NEWS.md).

async function key(): Promise<CryptoKey> {
  const b64 = Deno.env.get("MAIL_ENCRYPTION_KEY");
  let raw: Uint8Array;
  if (b64) raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  else {
    const seed = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "dev";
    raw = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mail-credentials:" + seed)));
  }
  if (raw.length !== 32) throw new Error("MAIL_ENCRYPTION_KEY must be 32 bytes base64");
  return crypto.subtle.importKey("raw", raw as unknown as ArrayBuffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptJSON(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), data));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptJSON<T>(payload: string): Promise<T> {
  const [ivs, cts] = payload.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivs) }, await key(), unb64(cts));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

/** HMAC-signed, expiring state for OAuth round trips. */
export async function signState(payload: Record<string, unknown>, ttlSec = 600): Promise<string> {
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + ttlSec * 1000 })).replace(/=+$/, "");
  const sig = await hmac(body);
  return `${body}.${sig}`;
}
export async function verifyState<T>(state: string): Promise<T | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig || (await hmac(body)) !== sig) return null;
  const obj = JSON.parse(atob(body));
  if (typeof obj.exp !== "number" || obj.exp < Date.now()) return null;
  return obj as T;
}
async function hmac(text: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "dev"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)));
  return b64(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
