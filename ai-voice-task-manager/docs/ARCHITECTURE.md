# Архитектура

## Принципы
1. **Собственная база — источник истины.** Gemini ничего не пишет напрямую: он возвращает структурированное предложение (`/parse`) или вызывает зарегистрированные инструменты (`/chat`), которые валидируются и исполняются backend-кодом под RLS пользователя.
2. **Даты не доверяются модели.** Модель возвращает семантические токены (`tomorrow`, `weekday:fri`, `in_hours:2`, `date:2026-10-09`), `dateService.ts` превращает их в абсолютные даты в таймзоне пользователя с учётом его настроек (утро = 09:00 и т. д.).
3. **Local-first iOS.** SwiftData хранит зеркало данных; все мутации сначала локальные, затем очередь `PendingSyncOp` отправляется в PostgREST. Pull — по `updated_at > cursor`.
4. **Приватность.** Ключ Gemini только в Supabase secrets; RLS на всех таблицах; аудио опционально и удаляется после расшифровки; Private mode не сохраняет расшифровки и историю чата на сервере.

## Компоненты

### Backend (`backend/supabase/functions`)
| Модуль | Ответственность |
|--------|----------------|
| `_shared/gemini.ts` | REST-клиент Gemini: `generateContent` (текст + аудио inline, `responseSchema`, function calling), `embedContent`, ретраи |
| `_shared/dateService.ts` | семантические даты → ISO с offset; повторения → `FREQ=…` правила; DST-безопасная конвертация без библиотек |
| `_shared/context.ts` | загрузка структуры пользователя и формирование контекста для промпта (проекты, направления, люди, синонимы, выученные исправления) |
| `_shared/matching.ts` | сопоставление имён с id (синонимы, стемминг RU/EN), правила маршрутизации, решение об авто-распределении |
| `_shared/resolve.ts` | пост-обработка вывода модели: валидация, приоритеты, даты, дедупликация, предупреждения |
| `_shared/tools.ts` | реестр инструментов для function calling, политика подтверждений (§39), создание задач, undo-батчи |
| `_shared/embeddings.ts` | эмбеддинги задач и семантический поиск через RPC `match_tasks` |
| `transcribe` | аудио → `original_transcript` + `clean_transcript` + язык |
| `parse` | транскрипт → `ParseResponse` (предложение, ничего не записывает) |
| `commit` | подтверждённые элементы → задачи/напоминания/проекты/люди в одном undo-батче |
| `chat` | диалог с инструментами; чтение сразу, опасные мутации → `pending_actions` |
| `execute-actions` | выполнение подтверждённых пользователем действий |
| `undo` | откат батча |
| `briefing` | статистика считается кодом, Gemini пишет только нарратив и порядок |
| `search` | ключевой + семантический поиск |
| `embed` | пересчёт эмбеддингов |

### База данных
Таблицы: `workspaces, projects, areas, organisations, people, status_columns, voice_entries, tasks, reminders, task_links, preference_profiles, classification_corrections, action_batches, chat_messages`.
Триггер `seed_user_defaults` создаёт для нового пользователя workspace «Работа»/«Личное», колонки Kanban и профиль предпочтений.
RPC: `match_tasks` (pgvector cosine), `routing_hints` (агрегированные исправления), `record_correction` (перенос задачи + запись исправления), `export_my_data`, `delete_my_chat_history`, `delete_my_account`.

### iOS (`ios/AIVoiceTaskManager`)
| Слой | Файлы |
|------|-------|
| App | `AIVoiceTaskManagerApp`, `AppEnvironment` (composition root), `RootTabView` (Today / Board / 🎙 / Chat / Projects) |
| Models | SwiftData-сущности (`Entities.swift`), DTO и семантические структуры (`DTOs.swift`) |
| Services | `SupabaseClient` (GoTrue/PostgREST/Functions/Storage), `APIService`, `SyncService`, `TaskRepository`, `VoiceProcessingCoordinator`, `AudioRecorder`, `LiveTranscriber`, `NotificationService`, `CalendarService`, `RemindersService`, `UndoService`, `AppLock`, `Keychain`, `NetworkMonitor`, `DateService` |
| Features | Today (+Agenda, Briefing), Plan, Board (Kanban), Voice (запись, обзор, редактор), Chat, Projects, Tasks, People, Search, Inbox, Settings, Auth |
| Intents | `AddTaskIntent`, `RemindMeIntent`, `WhatsTodayIntent`, `UrgentTasksIntent`, `StartRecordingIntent`, `CompleteTaskIntent`, `VoiceTasksShortcuts` |

## Политика подтверждений (§39)
| Действие | Подтверждение |
|----------|---------------|
| создать задачу / напоминание / проект / направление / контакт, завершить, переместить одну задачу | нет |
| удалить задачу, удалить проект | да |
| массовый перенос сроков (`reschedule_tasks`) | да |
| создать / изменить событие календаря | да |
| неоднозначный человек / совещание | выбор пользователя, модель не угадывает |

## Offline (§36)
- Запись сохраняется локально со статусом `waiting_for_processing`; `NetworkMonitor` запускает `processPending()` при появлении сети.
- Создание / просмотр / завершение задач работают локально, изменения ставятся в очередь.
- Siri-интенты работают через локальное хранилище.
