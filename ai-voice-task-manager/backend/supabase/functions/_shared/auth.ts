// Authentication + per-request Supabase clients. The user-scoped client enforces RLS; the service
// client is used only for operations that must bypass RLS (none in the MVP besides storage cleanup).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./cors.ts";
import { DEFAULT_PREFERENCES, type Preferences } from "./types.ts";

export interface RequestContext {
  userId: string;
  supabase: SupabaseClient; // user-scoped (RLS)
  prefs: Preferences;
  tz: string;
  now: Date;
}

export async function authenticate(req: Request): Promise<RequestContext> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "Missing bearer token");
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(authHeader.slice(7));
  if (error || !data.user) throw new HttpError(401, "Invalid token");
  const prefs = await loadPreferences(supabase, data.user.id);
  const tzHeader = req.headers.get("x-timezone");
  const tz = tzHeader && isTz(tzHeader) ? tzHeader : prefs.timezone;
  return { userId: data.user.id, supabase, prefs: { ...prefs, timezone: tz }, tz, now: new Date() };
}

function isTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function loadPreferences(supabase: SupabaseClient, userId: string): Promise<Preferences> {
  const { data } = await supabase.from("preference_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (!data) return { ...DEFAULT_PREFERENCES };
  return {
    ...DEFAULT_PREFERENCES,
    timezone: data.timezone ?? DEFAULT_PREFERENCES.timezone,
    morning: data.morning_time ?? DEFAULT_PREFERENCES.morning,
    day: data.day_time ?? DEFAULT_PREFERENCES.day,
    evening: data.evening_time ?? DEFAULT_PREFERENCES.evening,
    night: data.night_time ?? DEFAULT_PREFERENCES.night,
    end_of_day: data.end_of_day_time ?? DEFAULT_PREFERENCES.end_of_day,
    default_priority: data.default_priority ?? 3,
    auto_file_threshold: Number(data.auto_file_threshold ?? 0.85),
    aliases: data.aliases ?? {},
    routing_rules: data.routing_rules ?? {},
    delete_audio_after_transcription: data.delete_audio_after_transcription ?? true,
    private_mode: data.private_mode ?? false,
    apple_reminders_sync: data.apple_reminders_sync ?? "off",
    language: data.language ?? "ru",
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}
