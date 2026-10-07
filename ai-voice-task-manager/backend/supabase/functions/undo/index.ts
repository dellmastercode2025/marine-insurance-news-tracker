// POST /undo { batch_id }
import { serveWith } from "../_shared/handler.ts";
import { readJson } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/cors.ts";
import { undoBatch } from "../_shared/tools.ts";

serveWith(async (req, ctx) => {
  const { batch_id } = await readJson<{ batch_id: string }>(req);
  if (!batch_id) throw new HttpError(400, "batch_id required");
  const res = await undoBatch(ctx.supabase, ctx.userId, batch_id);
  return json(res);
});
