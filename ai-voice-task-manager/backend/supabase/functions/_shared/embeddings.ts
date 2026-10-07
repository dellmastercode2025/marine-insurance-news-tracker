import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { GeminiClient } from "./gemini.ts";

export function taskEmbeddingText(t: Record<string, any>): string {
  return [t.title, t.description, t.project?.name ?? t.project_name, t.area?.name ?? t.area_name, (t.tags ?? []).join(" "), t.waiting_subject, t.clean_transcript ?? t.original_transcript]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
}

/** Best-effort: never throws, embeddings are a search accelerator not a source of truth. */
export async function refreshTaskEmbeddings(supabase: SupabaseClient, gemini: GeminiClient, userId: string, taskIds: string[]): Promise<number> {
  let done = 0;
  for (const id of [...new Set(taskIds)]) {
    try {
      const { data } = await supabase.from("tasks").select("id,title,description,tags,waiting_subject,clean_transcript,original_transcript,project:projects(name),area:areas(name)").eq("id", id).eq("user_id", userId).maybeSingle();
      if (!data) continue;
      const vector = await gemini.embed(taskEmbeddingText(data), "RETRIEVAL_DOCUMENT");
      await supabase.from("tasks").update({ embedding: vector, embedding_updated_at: new Date().toISOString() }).eq("id", id);
      done++;
    } catch (e) {
      console.warn("embedding failed", id, e instanceof Error ? e.message : e);
    }
  }
  return done;
}

export async function semanticTaskIds(supabase: SupabaseClient, gemini: GeminiClient, userId: string, query: string, limit: number): Promise<string[]> {
  const vector = await gemini.embed(query, "RETRIEVAL_QUERY");
  const { data, error } = await supabase.rpc("match_tasks", { p_user_id: userId, query_embedding: vector, match_count: limit, min_similarity: 0.35 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { id: string }) => r.id);
}
