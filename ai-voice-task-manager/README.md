# AI Voice Task Manager

Персональный AI-ассистент для iPhone: вы говорите естественным языком (русский / английский / казахский / смешанный), приложение само разбивает сообщение на задачи, напоминания, события и ожидания, раскладывает их по проектам и направлениям, ставит сроки и приоритеты.

Реализация технического задания (MVP, §41). Языковая модель — **Google Gemini** (через backend; ключ никогда не попадает в приложение).

```
Пользователь → iPhone (SwiftUI, SwiftData, EventKit, App Intents)
                 ↓ HTTPS (Supabase Auth JWT)
             Supabase Edge Functions (Deno/TypeScript)
                 ↓                         ↓
             PostgreSQL + pgvector      Gemini API (транскрипция, разбор, чат, эмбеддинги)
```

## Структура репозитория

| Путь | Что это |
|------|---------|
| `backend/supabase/migrations/` | Схема PostgreSQL: таблицы, RLS, pgvector, RPC (семантический поиск, обучение на исправлениях, экспорт/удаление данных) |
| `backend/supabase/functions/_shared/` | Ядро: Gemini-клиент, DateService, сопоставление категорий, реестр инструментов (function calling), undo |
| `backend/supabase/functions/<name>/` | Edge-функции: `transcribe`, `parse`, `commit`, `chat`, `execute-actions`, `undo`, `briefing`, `search`, `embed` |
| `backend/tests/` | Unit-тесты чистых модулей (`npm test`), включая приёмочный сценарий §46 |
| `ios/` | Проект iOS (XcodeGen `project.yml` + исходники SwiftUI) |
| `web/` | Веб-версия (React + Vite), тот же backend и аккаунт; деплой на Vercel/Netlify |
| `docs/` | Архитектура, AI-пайплайн, API, инструкция по развёртыванию |

## Инструкции

- [docs/RUN_ON_IPHONE.md](docs/RUN_ON_IPHONE.md) — запуск на iPhone шаг за шагом
- [docs/WEB_AND_GOOGLE_LOGIN.md](docs/WEB_AND_GOOGLE_LOGIN.md) — сайт для компьютера и вход через Google-аккаунт
- [docs/MAIL_AND_NEWS.md](docs/MAIL_AND_NEWS.md) — подключение почты (письма без ответа) и новостные ленты, автообновление по расписанию

## Быстрый старт

1. **Backend** — см. [docs/SETUP.md](docs/SETUP.md): `supabase db push`, `supabase secrets set GEMINI_API_KEY=…`, `supabase functions deploy …`.
2. **iOS** — `cd ios && xcodegen generate`, впишите `SUPABASE_URL` и `SUPABASE_ANON_KEY` в `ios/Config/Local.xcconfig`, откройте `AIVoiceTaskManager.xcodeproj`, соберите на iPhone (iOS 17+).
3. **Тесты backend** — `cd backend && npm install && npm test && npm run typecheck`.

## Что реализовано из ТЗ

| § | Требование | Где |
|---|-----------|-----|
| 2, 4, 27 | Voice Inbox: запись, waveform, realtime-транскрипция, «Я нашёл N действий», «Добавить всё / Изменить / Отменить» | `ios/.../Features/Voice/*`, `VoiceProcessingCoordinator` |
| 3, 24 | Workspace → Project → Area → Subarea → Task, категории создаются автоматически | схема БД, `tools.ts: ensureProject/ensureArea`, `ProjectsView` |
| 5 | Original + clean transcript, настройка удаления аудио | `transcribe/index.ts`, `VoiceEntry`, Settings |
| 6, 33 | Строго структурированный вывод (responseSchema), AI не пишет в БД — только вызывает зарегистрированные функции | `schemas.ts`, `tools.ts`, `chat/index.ts` |
| 7, 40 | Классификация с учётом существующей структуры, синонимов, правил и исправлений пользователя (≥3 переноса) | `matching.ts`, `routing_hints`/`record_correction` RPC, `AliasesView` |
| 8 | Kanban с пользовательскими колонками и drag & drop | `BoardView`, `ColumnsEditorView` |
| 9, 23 | Today, Agenda (задачи + напоминания + Apple Calendar), План: Сегодня/Завтра/Неделя/Месяц/Просрочено/Без срока | `TodayView`, `AgendaView`, `PlanView` |
| 10 | Приоритеты P1–P4, P1 только при текстовом обосновании | `resolve.ts: sanitizePriority` |
| 11 | Waiting / follow-up | тип `waiting`, `follow_up_at`, экран задачи |
| 12, 29 | Напоминания: конкретное/относительное время, повторы, «за день до срока», «каждый час пока не отмечу» | `dateService.ts`, `NotificationService` |
| 13 | EventKit: чтение, создание, обновление своих событий, привязка к задаче | `CalendarService` |
| 14 | Apple Reminders: OFF / важные / с напоминанием / все | `RemindersService` |
| 15 | Siri и App Intents + Shortcuts | `Intents/AppIntents.swift` |
| 16 | AI Chat с доступом к базе через инструменты; массовые изменения — только после подтверждения | `chat/index.ts`, `execute-actions`, `ChatView` |
| 17 | Daily Briefing | `briefing/index.ts`, `BriefingCard`, уведомление по расписанию |
| 18 | Smart Inbox: порог уверенности, выбор между вариантами | `decideAutoFile`, `ExtractionReviewView`, `SmartInboxView` |
| 19 | Поиск: обычный + семантический (pgvector + Gemini embeddings) | `search/index.ts`, `match_tasks`, `SearchView` |
| 20, 21 | Связи задача–человек–организация–проект–запись–событие; People | `people`, `organisations`, `task_links`, `PeopleView` |
| 28 | Даты никогда не определяются только моделью: семантические токены → программный `DateService` с таймзоной | `dateService.ts` + тесты |
| 34, 35 | Face ID, Keychain, TLS, RLS, минимизация логов, Private processing mode, экспорт, удаление аккаунта | `AppLock`, `Keychain`, RLS в миграции, RPC `export_my_data` / `delete_my_account` |
| 36 | Offline: запись, создание/просмотр/завершение задач; обработка при появлении сети | SwiftData + `PendingSyncOp`, `NetworkMonitor` |
| 37, 39 | Неоднозначность → выбор; политика подтверждений | `tools.ts: pending()`, `findPerson` |
| 38 | Undo для массовых действий | `action_batches`, `undo/index.ts`, `UndoService`, баннер UNDO |
| 41.16 | Sync | `SyncService` (pull по `updated_at`, push очереди); веб — Supabase Realtime |
| доп. | Веб-доступ с компьютера, вход через Google | `web/`, Supabase Auth Google, PKCE в iOS |
| доп. | Новости: морское / авиационное страхование / Казахстан, AI-дайджест, автообновление | `_shared/news.ts`, `news`, `news-refresh`, `News.tsx`, `NewsView` |
| доп. | Переписки: Gmail / Microsoft 365 / IMAP только на чтение, письма без ответа, триаж AI, задачи из писем, инструменты чата | `_shared/mail/*`, `mail-oauth`, `mail-connect`, `mail-sync`, `Mail.tsx`, `MailView` |

Подробности: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/AI_PIPELINE.md](docs/AI_PIPELINE.md), [docs/API.md](docs/API.md).

## Ограничения текущей версии

- iOS-код написан без возможности сборки в этой среде (нет Xcode): ожидайте мелкие правки компилятора при первой сборке.
- Идентификаторы моделей Gemini задаются переменными окружения (`GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`); по умолчанию `gemini-3.5-flash` и `gemini-embedding-001` — проверьте доступность в вашем регионе/проекте.
- Аудио передаётся в Gemini inline (до ~19 МБ ≈ 35–40 минут AAC 64 kbps); для более длинных записей нужен Files API.
- Этап 2/3 (документы, email, виджеты, Watch, интеграции) не входит в MVP.
