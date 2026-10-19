# API Edge Functions

Все запросы: `POST https://<ref>.supabase.co/functions/v1/<name>`, заголовки `Authorization: Bearer <user JWT>`, `apikey: <anon>`, `Content-Type: application/json`, опционально `x-timezone: Asia/Almaty`.

| Функция | Тело | Ответ |
|---------|------|-------|
| `transcribe` | `{ audio_base64, mime_type, voice_entry_id?, language_hint?, live_transcript? }` | `{ language, original_transcript, clean_transcript }` |
| `parse` | `{ transcript, voice_entry_id?, original_transcript? }` | `ParseResponse { language, summary, items[], needs_review }` |
| `commit` | `{ voice_entry_id?, items: ResolvedItem[], original_transcript?, clean_transcript? }` | `{ batch_id, tasks[] }` |
| `chat` | `{ message, history?: [{role, content}], conversation_id? }` | `{ reply, executed[], pending_actions[], batch_id }` |
| `execute-actions` | `{ actions: [{name, args}], description? }` | `{ batch_id, results[] }` |
| `undo` | `{ batch_id }` | `{ undone }` |
| `briefing` | `{}` | статистика + `headline, narrative, critical[], suggested_order[]`, списки `due_today_list, events_list, overdue_list, waiting_list` |
| `search` | `{ query, limit?, semantic? }` | `{ tasks[], people[], projects[] }` |
| `embed` | `{ task_ids?, all_missing? }` | `{ embedded }` |
| `news` | `{ topic: marine\|aviation\|kazakhstan, refresh?, digest?, limit? }` | `{ topic, title, items[], refreshed_at, refresh_errors[], digest }` |
| `news-refresh` | `{}` + заголовок `x-cron-secret` | `{ ok, report }` (для расписания) |
| `mail-oauth` | POST `{ provider: gmail\|microsoft, return_url }` → `{ url }`; GET callback от провайдера | редирект на `return_url?mail=connected` |
| `mail-connect` | `{ action: "imap", email, host, port, secure, username, password }` или `{ action: "remove", account_id }` | `{ ok }` |
| `mail-sync` | `{ account_id? }` (JWT) или `{}` + `x-cron-secret` | `{ accounts: [{ email, fetched, pending, errors[] }] }` |

Таблицы `mail_accounts`, `mail_messages`, `news_items`, `news_digests` читаются клиентами напрямую через PostgREST (RLS). Инструменты чата для почты: `list_unanswered_emails`, `search_emails`, `mark_email_handled`.

`ResolvedItem` описан в `backend/supabase/functions/_shared/types.ts` и зеркально в `ios/.../Models/DTOs.swift`.

Коды ошибок: 400 (валидация), 401 (нет/просрочен JWT), 413 (слишком большое аудио/транскрипт), 415 (mime), 502 (ошибка Gemini), 500.
