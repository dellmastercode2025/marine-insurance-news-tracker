# Развёртывание

## 1. Supabase

```bash
npm i -g supabase            # CLI
cd backend
supabase login
supabase link --project-ref <your-project-ref>
supabase db push             # применяет migrations/20261007000000_init.sql (pgvector, RLS, RPC, bucket "audio")
cp supabase/.env.example supabase/.env   # впишите GEMINI_API_KEY
supabase secrets set --env-file supabase/.env
supabase functions deploy transcribe parse commit chat execute-actions undo briefing search embed
```

Функции задеплоены с `verify_jwt = false` в `config.toml`, потому что проверяют JWT сами (`_shared/auth.ts`) и формируют RLS-клиент пользователя.

### Аутентификация
- **Email OTP** работает сразу (в `config.toml` включён `auth.email`).
- **Sign in with Apple**: в Supabase Dashboard → Authentication → Providers → Apple укажите Services ID и secret (переменные `APPLE_SERVICES_ID`, `APPLE_CLIENT_SECRET`). В Xcode включите capability *Sign in with Apple*.

### Переменные окружения функций
| Имя | По умолчанию | Назначение |
|-----|--------------|-----------|
| `GEMINI_API_KEY` | — | ключ Google AI Studio / Gemini API |
| `GEMINI_MODEL` | `gemini-3.5-flash` | транскрипция, разбор, чат, сводка |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | эмбеддинги для семантического поиска |
| `GEMINI_EMBEDDING_DIMENSIONS` | `768` | должно совпадать с `vector(768)` в схеме |

Локальная разработка: `supabase start && supabase functions serve --env-file supabase/.env`.

## 2. iOS

```bash
brew install xcodegen
cd ios
cat > Config/Local.xcconfig <<EOT
SUPABASE_URL = https:/$()/<ref>.supabase.co
SUPABASE_ANON_KEY = <anon key>
EOT
xcodegen generate
open AIVoiceTaskManager.xcodeproj
```

- Target iOS 17.0, Swift 5.10, без внешних зависимостей (Supabase — собственный лёгкий REST-клиент).
- Замените `com.example.aivoicetasks` на ваш bundle id (в `project.yml`, `Info.plist`, entitlements, `AppConfig`).
- Capabilities: Sign in with Apple, Siri, Background Modes (audio, fetch, processing), Keychain.
- Первый запуск спрашивает доступ к микрофону, распознаванию речи, уведомлениям, календарю (напоминания — только при включении в настройках).

## 3. Тесты

```bash
cd backend && npm install && npm test && npm run typecheck
```

`tests/resolve.test.ts` воспроизводит приёмочный сценарий §46: 4 элемента, правильные проекты/направления, сроки, waiting/follow-up, дедупликация, запрос уточнения при низкой уверенности.
