# Как запустить приложение на своём iPhone — пошагово

Время: 1,5–2 часа при первом прохождении. Порядок важен: сначала backend, потом телефон.

## Что понадобится

| Что | Зачем | Где взять |
|-----|-------|-----------|
| Mac с macOS 14 Sonoma или новее | Приложения для iPhone собираются только в Xcode на Mac | свой, рабочий или арендованный (MacinCloud, MacStadium — от ~$30/мес) |
| Xcode 16 (бесплатно, ~12 ГБ) | компилятор и загрузка на телефон | App Store на Mac |
| iPhone с iOS 17 или новее + кабель | целевое устройство | — |
| Apple ID | подпись приложения | бесплатный достаточно для теста (приложение живёт 7 дней, потом переустановить); платный Developer Program ($99/год) — без ограничения по времени, плюс Sign in with Apple и Siri |
| Аккаунт Google + ключ Gemini API | ИИ-часть | https://aistudio.google.com |
| Аккаунт Supabase (бесплатный тариф) | база данных, авторизация, backend-функции | https://supabase.com |
| Homebrew на Mac | установка утилит одной командой | https://brew.sh |

---

## Часть 1. Получить код

Откройте Terminal на Mac и выполните:

```bash
cd ~/Desktop
git clone https://github.com/dellmastercode2025/marine-insurance-news-tracker.git
cd marine-insurance-news-tracker
git checkout claude/ai-voice-task-manager
cd ai-voice-task-manager
```

Проверка: команда `ls` показывает папки `backend`, `ios`, `docs`.

---

## Часть 2. Ключ Gemini

1. Откройте https://aistudio.google.com, войдите в Google-аккаунт.
2. Слева **Get API key** → **Create API key** → выберите или создайте проект.
3. Скопируйте ключ (строка вида `AIza...`). Сохраните в заметках, он понадобится в шаге 3.6.

Проверка ключа (подставьте свой ключ):

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=ВАШ_КЛЮЧ" | grep -o '"name": "models/gemini[^"]*"' | head
```

Должен появиться список моделей. Запомните одну из них со словом `flash` (например `models/gemini-3.5-flash` или `models/gemini-2.5-flash`) — если в списке нет `gemini-3.5-flash`, в шаге 3.6 укажете ту, что есть.

---

## Часть 3. Backend на Supabase

### 3.1 Создать проект
1. https://supabase.com → **Sign in** → **New project**.
2. Name: `voice-tasks`. **Database password** — придумайте и запишите (понадобится в 3.4). Region: ближайший (например Frankfurt или Singapore).
3. Дождитесь статуса «Project is ready» (1–2 минуты).

### 3.2 Записать адреса и ключи
В проекте: **Project Settings** (шестерёнка внизу слева) → **API**. Скопируйте в заметки:
- **Project URL** — вида `https://abcdefghijkl.supabase.co`
- **anon public** key — длинная строка `eyJ...`
- **Reference ID** (там же, в General) — это `abcdefghijkl` из URL.

### 3.3 Установить Supabase CLI
```bash
brew install supabase/tap/supabase
supabase --version
```

### 3.4 Привязать проект
```bash
cd ~/Desktop/marine-insurance-news-tracker/ai-voice-task-manager/backend
supabase login          # откроется браузер, подтвердите
supabase link --project-ref ВАШ_REFERENCE_ID
```
CLI спросит пароль базы — введите тот, что задали в 3.1.

### 3.5 Создать таблицы
```bash
supabase db push
```
Ответьте `Y`. В конце должно быть `Finished supabase db push`.

Проверка: в Supabase → **Table Editor** появились таблицы `tasks`, `projects`, `voice_entries` и другие.

### 3.6 Положить ключ Gemini на сервер
```bash
cp supabase/.env.example supabase/.env
nano supabase/.env
```
Впишите:
```
GEMINI_API_KEY=AIza...ваш ключ
GEMINI_MODEL=gemini-3.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_EMBEDDING_DIMENSIONS=768
```
Если в шаге 2 модели `gemini-3.5-flash` в списке не было, впишите ту, что была (например `gemini-2.5-flash`). Строки `APPLE_*` можно удалить или оставить пустыми. Сохраните: `Ctrl+O`, Enter, `Ctrl+X`.

```bash
supabase secrets set --env-file supabase/.env
supabase secrets list
```
В списке должен быть `GEMINI_API_KEY`.

### 3.7 Задеплоить функции
```bash
supabase functions deploy transcribe parse commit chat execute-actions undo briefing search embed --no-verify-jwt
```
Проверка: Supabase → **Edge Functions** — девять функций со статусом Active.

### 3.8 Включить вход по email
Supabase → **Authentication** → **Providers** → **Email**: переключатель **Enable Email provider** включён (по умолчанию да). Больше ничего менять не нужно: приложение использует одноразовый код из письма.

Обратите внимание: встроенная почта Supabase на бесплатном тарифе отправляет мало писем в час. Если код не приходит дважды подряд — подождите час или подключите свой SMTP (**Project Settings → Authentication → SMTP Settings**).

### 3.9 (по желанию) Вход через Google
Чтобы входить Gmail-аккаунтом (и на телефоне, и на сайте), выполните шаг A из [WEB_AND_GOOGLE_LOGIN.md](WEB_AND_GOOGLE_LOGIN.md). Без него работает вход по коду на email — это тот же аккаунт, если указать тот же адрес Gmail.

Backend готов.

---

## Часть 4. Подготовить Mac и Xcode

1. Установите **Xcode** из App Store, откройте его один раз и примите лицензию. Если спросит про дополнительные компоненты для iOS — установите.
2. В Xcode: **Settings** (⌘,) → **Accounts** → **+** → **Apple ID** → войдите своим Apple ID.
3. Установите генератор проекта:
```bash
brew install xcodegen
```

---

## Часть 5. Собрать проект

### 5.1 Указать адрес вашего backend
```bash
cd ~/Desktop/marine-insurance-news-tracker/ai-voice-task-manager/ios
cat > Config/Local.xcconfig <<'EOT'
SUPABASE_URL = https:/$()/ВАШ_REFERENCE_ID.supabase.co
SUPABASE_ANON_KEY = eyJ...ваш anon key
EOT
```
Запись `https:/$()/` — это не опечатка, так в xcconfig записывают `//`, чтобы они не считались комментарием. Подставьте свой Reference ID и anon key.

### 5.2 Выбрать свой идентификатор приложения
Bundle ID должен быть уникальным. Замените `com.example.aivoicetasks` на свой, например `com.ivanov.voicetasks`:

```bash
cd ~/Desktop/marine-insurance-news-tracker/ai-voice-task-manager/ios
grep -rl "com.example.aivoicetasks" . | xargs sed -i '' 's/com.example.aivoicetasks/com.ivanov.voicetasks/g'
```

### 5.3 Если у вас бесплатный Apple ID
Две возможности доступны только платным разработчикам — Sign in with Apple и Siri. Отключите их, иначе Xcode не подпишет приложение:

```bash
cat > AIVoiceTaskManager/Resources/AIVoiceTaskManager.entitlements <<'EOT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
EOT
```
Вход в приложение в этом случае — по email-коду (кнопка Apple не будет работать, её можно игнорировать). Все остальные функции, включая голосовой ввод, календарь и уведомления, работают. Команды Shortcuts тоже работают; не будет только голосового вызова «Siri, …».

С платным аккаунтом этот шаг пропустите, но в Supabase → Authentication → Providers → Apple нужно будет включить провайдер и указать Services ID/secret из developer.apple.com (это отдельная настройка на 20–30 минут; для первого запуска не требуется, email-вход работает и так).

### 5.4 Сгенерировать и открыть проект
```bash
xcodegen generate
open AIVoiceTaskManager.xcodeproj
```

### 5.5 Настроить подпись в Xcode
1. Слева в дереве кликните корень **AIVoiceTaskManager** (синяя иконка) → вкладка **Signing & Capabilities**.
2. **Automatically manage signing** — галочка.
3. **Team** — выберите свой Apple ID (у бесплатного будет «(Personal Team)»).
4. Если видите красные ошибки про Sign in with Apple или Siri — вы на бесплатном аккаунте и не сделали шаг 5.3; сделайте и повторите `xcodegen generate`.

---

## Часть 6. Подготовить iPhone

1. Подключите iPhone кабелем к Mac. На телефоне нажмите **Доверять этому компьютеру**, введите код-пароль.
2. На iPhone: **Настройки → Конфиденциальность и безопасность → Режим разработчика** (Developer Mode) → включить → телефон перезагрузится → подтвердить включение. Если пункта нет, он появится после первой попытки запуска из Xcode.
3. В Xcode вверху, рядом с кнопкой ▶, в выпадающем списке устройств выберите **ваш iPhone** (не симулятор).

---

## Часть 7. Запуск

1. Нажмите **▶** (или ⌘R). Первая сборка 2–5 минут.
2. Если Xcode покажет ошибки компиляции — скопируйте текст ошибок (панель слева, иконка треугольника) и пришлите мне: код писался без возможности собрать его в Xcode, 1–3 мелкие правки ожидаемы.
3. При первом запуске телефон может сказать «Ненадёжный разработчик». Тогда на iPhone: **Настройки → Основные → VPN и управление устройством** → ваш Apple ID → **Доверять**. Запустите приложение с домашнего экрана снова.
4. В приложении: **Войти через Google** (если настроен шаг 3.9) или введите email → **Получить код на email** → введите 6-значный код из письма → **Войти**.
5. Разрешите микрофон, распознавание речи, уведомления и календарь (появятся по очереди).

### Первая проверка
Нажмите красную кнопку микрофона и скажите:

> «По Казмортрансфлоту: по рискам завтра проверить реестр. По страхованию до пятницы получить ответ от Дениса по WTW, если не ответит — напомнить. По ОСИ вечером написать Берику насчёт двери.»

Через 5–15 секунд появится экран «Я нашёл 3 действия» с проектами, сроками и приоритетами. Нажмите **Добавить всё**. Задачи появятся на вкладках Сегодня, Доска и Проекты; напоминание придёт вечером.

Затем во вкладке **Чат** спросите «Что у меня на этой неделе?».

---

## Если что-то не работает

| Симптом | Причина и действие |
|---------|--------------------|
| Xcode: ошибки компиляции (красные) | пришлите мне текст ошибок, исправлю |
| Xcode: «No signing certificate» / «Failed to register bundle identifier» | шаг 5.2 (уникальный Bundle ID) и 5.5 (Team) |
| Xcode: ошибка про entitlements Siri / applesignin | бесплатный аккаунт → шаг 5.3 |
| iPhone: «Не удалось проверить приложение» | нет интернета на телефоне при первом запуске или не выполнен пункт 7.3 |
| Приложение: «Ошибка сервера 401» | неверный anon key в `Config/Local.xcconfig`; исправьте, `xcodegen generate`, пересоберите |
| Приложение: «Ошибка сервера 404» при записи | функции не задеплоены (шаг 3.7) или неверный `SUPABASE_URL` |
| Приложение: «AI provider error … 404 … model not found» | в `supabase/.env` указана недоступная модель; впишите модель из списка шага 2, повторите `supabase secrets set --env-file supabase/.env` |
| «AI provider error … 429» | исчерпана бесплатная квота Gemini; подождите минуту или включите биллинг в Google AI Studio |
| Код на email не приходит | лимит писем Supabase; подождите час или настройте SMTP (шаг 3.8) |
| Приложение перестало открываться через неделю | бесплатный Apple ID: подпись действует 7 дней; подключите телефон и нажмите ▶ ещё раз |
| Логи backend | Supabase → Edge Functions → имя функции → Logs |

## Обновление после правок кода

```bash
cd ~/Desktop/marine-insurance-news-tracker
git pull
cd ai-voice-task-manager/backend && supabase functions deploy --no-verify-jwt   # если менялся backend
cd ../ios && xcodegen generate && open AIVoiceTaskManager.xcodeproj               # затем ▶ в Xcode
```
