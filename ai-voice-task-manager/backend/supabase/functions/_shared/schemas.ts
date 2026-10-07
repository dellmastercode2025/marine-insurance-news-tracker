// JSON response schemas (OpenAPI subset accepted by Gemini responseSchema).

const semanticDate = {
  type: "object",
  nullable: true,
  description: "Semantic date; never an absolute timestamp unless the user said an explicit calendar date.",
  properties: {
    day: {
      type: "string",
      nullable: true,
      description:
        "today | tomorrow | day_after_tomorrow | weekday:<mon..sun> | next_weekday:<mon..sun> | this_week | end_of_week | next_week | end_of_month | next_month | in_days:N | in_weeks:N | in_hours:N | in_minutes:N | date:YYYY-MM-DD",
    },
    time: { type: "string", nullable: true, description: "morning | day | evening | night | HH:mm" },
    text: { type: "string", nullable: true, description: "original phrase" },
  },
};

const recurrence = {
  type: "object",
  nullable: true,
  properties: {
    freq: { type: "string", enum: ["hourly", "daily", "weekly", "monthly", "yearly"] },
    interval: { type: "integer", nullable: true },
    by_weekday: { type: "array", nullable: true, items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] } },
    until_done: { type: "boolean", nullable: true },
    text: { type: "string", nullable: true },
  },
  required: ["freq"],
};

export const PARSE_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string", description: "BCP-47 of the dominant language, e.g. ru, en, kk" },
    summary: { type: "string", description: "One-sentence summary of the whole message in the user's language" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["task", "reminder", "event", "waiting", "note"] },
          title: { type: "string", description: "Short imperative title in the user's language, ≤ 80 chars" },
          description: { type: "string", nullable: true },
          workspace: { type: "string", nullable: true },
          project: { type: "string", nullable: true, description: "Existing project name when one matches" },
          area: { type: "string", nullable: true },
          subarea: { type: "string", nullable: true },
          priority: { type: "integer", nullable: true, description: "1 critical, 2 high, 3 normal, 4 low" },
          priority_reason: { type: "string", nullable: true },
          due: semanticDate,
          reminder: semanticDate,
          reminder_before_due: { type: "string", nullable: true, description: "e.g. 1d, 2h" },
          recurrence,
          event_start: semanticDate,
          event_end: semanticDate,
          person: { type: "string", nullable: true },
          organisation: { type: "string", nullable: true },
          waiting_for: { type: "string", nullable: true, description: "Person we are waiting on" },
          waiting_subject: { type: "string", nullable: true },
          follow_up: semanticDate,
          tags: { type: "array", nullable: true, items: { type: "string" } },
          confidence: { type: "number", description: "0..1 confidence in the classification (project/area)" },
          alternatives: {
            type: "array",
            nullable: true,
            items: {
              type: "object",
              properties: {
                project: { type: "string", nullable: true },
                area: { type: "string", nullable: true },
                reason: { type: "string", nullable: true },
              },
            },
          },
          source_quote: { type: "string", nullable: true, description: "Verbatim fragment of the transcript this item came from" },
        },
        required: ["type", "title", "confidence"],
      },
    },
  },
  required: ["language", "summary", "items"],
};

export const TRANSCRIPT_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string" },
    original_transcript: { type: "string", description: "Literal transcription, including fillers and self-corrections" },
    clean_transcript: { type: "string", description: "Same content with fillers removed and obvious recognition errors fixed" },
  },
  required: ["language", "original_transcript", "clean_transcript"],
};

export const BRIEFING_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    narrative: { type: "string", description: "3-6 short sentences in the user's language" },
    critical: { type: "array", items: { type: "object", properties: { task_id: { type: "string" }, line: { type: "string" } }, required: ["task_id", "line"] } },
    suggested_order: { type: "array", items: { type: "string" }, description: "task ids in recommended execution order" },
  },
  required: ["headline", "narrative", "critical", "suggested_order"],
};
