# Переписки (почта) и Новости

## 1. Раздел «Переписки»

### Что делает
- Подключает почтовый ящик **только на чтение** и каждые 15 минут (на вебе — пока вкладка открыта; на сервере — по расписанию, см. §3) загружает входящие и отправленные за последние 14 дней.
- По каждой цепочке писем определяет: последнее письмо — входящее, адресовано вам, после него вы не отвечали, отправитель не робот/рассылка. Такие письма проходят AI-триаж (Gemini): «действительно ли требуется ваш ответ», приоритет P1–P4, причина, предлагаемое действие.
- Показывает список **«Без ответа»** с количеством дней ожидания; из письма можно создать задачу, отметить «Я ответил» или «Ответ не нужен». Когда вы отвечаете в почте, при следующей синхронизации письмо само уходит из списка.
- Чат понимает запросы «какие письма у меня без ответа», «что ждёт от меня Денис по почте», «найди письмо от WTW про котировку», «создай задачу по письму …». Утренняя сводка упоминает письма без ответа.

### Как подключить ящик a.umarov@kmtf.kmg.kz

Корпоративная почта КМГ, скорее всего, работает на Microsoft Exchange. Возможны три пути — попробуйте по порядку.

**Вариант 1 — Microsoft 365 / Outlook (если почта в облаке Microsoft).**
1. Зайдите на https://portal.azure.com под своим Microsoft-аккаунтом (можно создать бесплатный личный аккаунт — регистрация приложения не обязана быть в корпоративном тенанте).
2. **Microsoft Entra ID → App registrations → New registration**. Name `Voice Tasks Mail`. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**. Redirect URI: тип Web, значение
   ```
   https://<ref>.supabase.co/functions/v1/mail-oauth
   ```
3. После создания: **Certificates & secrets → New client secret** → скопируйте Value. На странице Overview скопируйте **Application (client) ID**.
4. **API permissions → Add a permission → Microsoft Graph → Delegated**: `Mail.Read`, `User.Read`, `offline_access`, `openid`, `email`.
5. Сохраните секреты в Supabase:
   ```bash
   cd backend
   supabase secrets set MS_OAUTH_CLIENT_ID=… MS_OAUTH_CLIENT_SECRET=… MS_OAUTH_TENANT=common
   ```
6. В приложении: Переписки → **Подключить почту → Microsoft 365 / Outlook** → войдите корпоративным аккаунтом → разрешите доступ.
   Если появится «Need admin approval» — в вашем тенанте запрещено самостоятельное согласие пользователей. Попросите IT-администратора КМГ одобрить приложение (Application ID из п. 3) или перейдите к варианту 2/3.

**Вариант 2 — IMAP (если Exchange локальный / IMAP включён).**
1. Узнайте у IT адрес IMAP-сервера (например `mail.kmg.kz`), порт (обычно 993, SSL) и нужен ли отдельный пароль приложения.
2. Переписки → Подключить почту → **IMAP** → заполните форму → «Подключить». Приложение проверит соединение и сохранит пароль в зашифрованном виде (AES-256-GCM, ключ `MAIL_ENCRYPTION_KEY` на сервере).
   Для Exchange Online (облако Microsoft) этот вариант не сработает — там отключён вход в IMAP по паролю.

**Вариант 3 — пересылка в Gmail.**
Если ни один способ не разрешён корпоративной политикой: настройте в Outlook правило пересылки входящих на ваш Gmail (если это допускается политикой безопасности) и подключите Gmail. Отправленные письма в этом случае не видны, поэтому отмечайте «Я ответил» вручную или дайте приложению доступ к Gmail, из которого отвечаете.

**Gmail / Google Workspace** (для личной почты или варианта 3):
1. В том же Google Cloud проекте, что и для входа (см. WEB_AND_GOOGLE_LOGIN.md): **APIs & Services → Library → Gmail API → Enable**.
2. **Credentials → Create credentials → OAuth client ID → Web application**, Authorized redirect URI:
   ```
   https://<ref>.supabase.co/functions/v1/mail-oauth
   ```
   (можно добавить этот URI к уже созданному клиенту для входа).
3. OAuth consent screen → Scopes → добавьте `.../auth/gmail.readonly`. Пока приложение в режиме Testing, ваш Gmail должен быть в Test users.
4. `supabase secrets set GOOGLE_OAUTH_CLIENT_ID=… GOOGLE_OAUTH_CLIENT_SECRET=…`
5. Переписки → Подключить почту → **Gmail**.

Общие секреты (один раз):
```bash
supabase secrets set MAIL_ENCRYPTION_KEY="$(openssl rand -base64 32)" CRON_SECRET="$(openssl rand -hex 24)" APP_URLS="https://ВАШ-САЙТ.vercel.app,http://localhost:5173,aivoicetasks://mail-connected"
supabase functions deploy mail-oauth mail-connect mail-sync news news-refresh chat briefing --no-verify-jwt
supabase db push
```

### Конфиденциальность
- Доступ к почте только на чтение; приложение ничего не отправляет и не удаляет.
- Хранятся: заголовки, первые 4000 символов текста без цитируемой истории, ссылка на письмо. Вложения не загружаются.
- В Gemini передаются только письма-кандидаты (тема, отправитель, до 1200 символов) для ответа «нужен ли ответ».
- Токены/пароли зашифрованы на сервере; таблица `mail_credentials` недоступна клиентам (RLS без политик).
- Отключение ящика удаляет все загруженные письма; «Удалить аккаунт» удаляет всё.
- Перед подключением корпоративной почты убедитесь, что это не противоречит политике ИБ КМГ: по сути вы передаёте копии писем во внешний сервис (Supabase + Google Gemini).

## 2. Раздел «Новости»

Три ленты: **Морское страхование**, **Авиационное страхование**, **Страхование в Казахстане**. Источники: Google News (поисковые запросы на английском и русском), Insurance Journal, Reinsurance News, gCaptain, Splash247, Maritime Executive, Kursiv, Kapital.kz с фильтром по страховым ключевым словам. Список в `backend/supabase/functions/_shared/news.ts` — добавляйте свои RSS.

- Лента обновляется автоматически при открытии раздела, если данные старше 30 минут, и по расписанию (§3). Новости старше 60 дней удаляются.
- Кнопка **AI-дайджест** собирает за 3 дня «Главное / Что это значит для нас / Остальное» на русском со ссылками на источники; дайджест кешируется на день.
- Чат на вопросы о новостях отправляет в этот раздел (инструмента новостей у чата нет намеренно, чтобы не смешивать задачи и ленту).

## 3. Автообновление по расписанию (pg_cron)

Чтобы почта и новости обновлялись без открытого приложения, запустите в Supabase → **SQL Editor** один раз (подставьте ref и CRON_SECRET):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Новости: каждый час
select cron.schedule('news-refresh', '7 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/news-refresh',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
    body := '{}'::jsonb);
$$);

-- Почта: каждые 15 минут
select cron.schedule('mail-sync', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/mail-sync',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
    body := '{}'::jsonb);
$$);
```

Проверить: `select * from cron.job;` и логи функций в Supabase → Edge Functions → Logs. Остановить: `select cron.unschedule('mail-sync');`.
