# Vicel — сайт + Email OTP бэкенд

Официальный сайт vicel.work: профиль с аватарками, форум Vicel Team, подписки (FREE / Premium), оплата через Telegram-бота (@vicelbuy_bot), GGSel и CryptoBot.

## Структура

- `server.js` — бэкенд (obfuscated build): аутентификация (Email OTP через Resend), сессии, подписки, форум, аватарки
- `main.js` — фронтенд-логика (obfuscated build)
- `index.html` / `style.css` / `logo.png` — разметка и оформление

Исходный код и Telegram-бот в публичный репозиторий не входят.
Запуск требует файлов `.env` (см. `.env.example`) — они не публикуются.

## Запуск

```bash
npm install
cp .env.example .env   # заполните RESEND_API_KEY, INTERNAL_SECRET, SUPABASE_DB_URL
npm start              # http://localhost:3000
```

Бот: `tgbot/.env` (BOT_TOKEN, CRYPTO_PAY_API_TOKEN, SITE_API_SECRET и т.д.) → `python main.py`

## Безопасность

| Категория | Реализация |
|---|---|
| Пароли | bcrypt, cost 12; в открытом виде не хранятся и не логируются |
| Сессии | Серверные токены 256 бит, кука `HttpOnly + SameSite=Strict (+ Secure на HTTPS)`, скользящий TTL 7 дней |
| CSRF | Double-submit токен (кука + заголовок) на каждой мутации |
| Валидация | zod-схемы со `.strict()` — mass assignment невозможен; лимит тела 16 КБ |
| SQL-инъекции | Параметризованные запросы (`$1`) + read-only доступ к базе бота |
| OTP | 6 цифр, TTL 10 минут, хэш SHA-256 с солью, 5 попыток, кулдаун 60 с |
| Brute force | Rate limit на каждый эндпоинт + lockout 15 мин после 5 неудачных входов |
| XSS | CSP (`script-src 'self'`, `frame-ancestors 'none'`), экранирование всего пользовательского ввода |
| Ошибки | Клиенту — только общие сообщения; детали в серверный лог без секретов |
| Секреты | Только в `.env` (не в git). Для БД — отдельная роль с правом `SELECT` |
| Аватарки | MIME whitelist, проверка magic bytes, 1 МБ, случайное имя файла, раздача через контролируемый роут |
| Подписки | Ключи бота активируются один раз (`hwid IS NULL`), повторная активация невозможна |

## Подписки

Ключ из бота → Профиль → «Активировать». Сайт проверяет ключ в базе (Supabase Postgres / SQLite бота), выдаёт Premium и помечает его использованным. Повторная активация и чужие ключи отклоняются.
