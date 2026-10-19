# Веб-версия (доступ с компьютера) и вход через Google

Веб-приложение в папке `web/` работает с тем же backend и той же базой, что и iPhone. Один аккаунт — все устройства. Изменения на телефоне появляются на компьютере через несколько секунд (Supabase Realtime) и наоборот.

Что умеет веб-версия: Сегодня, План, Kanban-доска с drag & drop, Проекты, Люди, Чат с AI, Переписки (почта), Новости, Поиск, Настройки, голосовой ввод через микрофон компьютера (Chrome, Edge, Safari 17+), текстовый ввод поручений, UNDO.
Чего нет на вебе: push-уведомления и интеграция с Apple Calendar/Reminders — это остаётся на iPhone.

## Шаг A. Вход через Google (Gmail-аккаунт)

### A.1 Создать OAuth-клиент в Google Cloud (10 минут)
1. Откройте https://console.cloud.google.com → вверху выберите или создайте проект (например `voice-tasks`).
2. Меню → **APIs & Services → OAuth consent screen**. User type: **External**. App name: `Voice Tasks`, support email: ваш Gmail. Scopes: ничего добавлять не нужно. Test users: добавьте свой Gmail. Сохраните. (Пока приложение в статусе Testing, входить могут только test users — для личного использования этого достаточно.)
3. **APIs & Services → Credentials → + Create credentials → OAuth client ID**. Application type: **Web application**. Name: `Supabase Auth`.
4. **Authorized redirect URIs** → Add URI:
   ```
   https://<ВАШ_REFERENCE_ID>.supabase.co/auth/v1/callback
   ```
5. Create → скопируйте **Client ID** и **Client secret**.

### A.2 Включить Google в Supabase
1. Supabase → **Authentication → Providers → Google** → Enable. Вставьте Client ID и Client Secret. Save.
2. **Authentication → URL Configuration**:
   - **Site URL**: адрес вашего сайта (после шага B, например `https://voice-tasks.vercel.app`). До деплоя можно оставить `http://localhost:5173`.
   - **Redirect URLs** → добавьте строки:
     ```
     http://localhost:5173
     https://voice-tasks.vercel.app
     aivoicetasks://auth-callback
     ```
     (последняя строка — для входа через Google на iPhone).

Теперь кнопка «Войти через Google» работает и на вебе, и в iOS-приложении (кнопка под Sign in with Apple; работает и с бесплатным Apple ID).

Важно: вход по email-коду и вход через Google с тем же адресом — это один и тот же пользователь в Supabase, данные общие.

## Шаг B. Разместить сайт (Vercel, бесплатно, 10 минут)

1. Код должен лежать в вашем GitHub (он уже там: репозиторий `marine-insurance-news-tracker`, ветка `claude/ai-voice-task-manager`). Если вы сольёте ветку в `main`, укажите `main` ниже.
2. https://vercel.com → Sign up with GitHub → **Add New → Project** → Import репозиторий.
3. Настройки проекта:
   - **Root Directory**: `ai-voice-task-manager/web`
   - **Framework Preset**: Vite (определится сам)
   - **Build Command**: `npm run build`, **Output Directory**: `dist`
   - **Environment Variables**:
     | Name | Value |
     |------|-------|
     | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
     | `VITE_SUPABASE_ANON_KEY` | anon key из Supabase → Project Settings → API |
   - Production Branch (Settings → Git): `claude/ai-voice-task-manager` или `main`.
4. **Deploy**. Через 1–2 минуты получите адрес вида `https://voice-tasks-xxx.vercel.app`. Можно привязать свой домен (Settings → Domains).
5. Вернитесь в Supabase → Authentication → URL Configuration и впишите этот адрес в Site URL и Redirect URLs (шаг A.2).
6. Добавьте адрес в секрет `APP_URLS` функций (нужно для подключения почты, см. MAIL_AND_NEWS.md):
   ```bash
   cd backend && supabase secrets set APP_URLS="https://voice-tasks-xxx.vercel.app,http://localhost:5173,aivoicetasks://mail-connected"
   ```

Альтернативы Vercel: Netlify (в репозитории есть `netlify.toml`, те же переменные) или Cloudflare Pages.

## Локальный запуск на компьютере (без хостинга)

```bash
cd ai-voice-task-manager/web
cp .env.example .env     # впишите VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY
npm install
npm run dev              # откройте http://localhost:5173
```

## Проверка
1. Откройте сайт → «Войти через Google» → выберите Gmail-аккаунт → попадёте на экран «Сегодня».
2. Нажмите «🎙 Записать» (браузер спросит доступ к микрофону), надиктуйте поручения, подтвердите.
3. Откройте приложение на iPhone под тем же Google-аккаунтом — задачи уже там.
