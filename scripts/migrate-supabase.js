// Переносит данные из локальной data/db.json в Supabase.
// Запуск: node scripts/migrate-supabase.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const dbFile = path.join(__dirname, '..', 'data', 'db.json');
  if (!fs.existsSync(dbFile)) {
    console.log('[migrate] локальная db.json не найдена');
    process.exit(0);
  }
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));

  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Пользователи (+ аватар из файла, если есть)
  for (const u of db.users || []) {
    let avatar = null;
    if (u.avatar) {
      const p = path.join(__dirname, '..', 'data', 'avatars', u.avatar);
      if (fs.existsSync(p)) {
        const b = fs.readFileSync(p);
        avatar = 'data:image/jpeg;base64,' + b.toString('base64');
      }
    }
    await client.query(
      `INSERT INTO site_users (id, uid, nick, email, pass_hash, created, is_admin, banned, avatar, plan, plan_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (email) DO NOTHING`,
      [u.id, u.uid ?? null, u.nick, u.email, u.passHash, u.createdAt || 0,
       !!u.isAdmin, !!u.banned, avatar, u.plan || 'free', u.planExpiresAt || null]
    );
    console.log('[user] ' + u.nick + ' (UID ' + (u.uid ?? '?') + ')');
  }

  // Темы форума
  for (const t of db.topics || []) {
    await client.query(
      `INSERT INTO site_topics (id, title, author, author_email, created, posts)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.title, t.author, t.authorEmail, t.created, JSON.stringify(t.posts)]
    );
  }
  console.log('[topics] ' + (db.topics || []).length);

  // Баны
  for (const e of db.bannedEmails || []) {
    await client.query(`INSERT INTO site_bans (type, value) VALUES ('email',$1) ON CONFLICT DO NOTHING`, [e]);
  }
  for (const n of db.bannedNicks || []) {
    await client.query(`INSERT INTO site_bans (type, value) VALUES ('nick',$1) ON CONFLICT DO NOTHING`, [n]);
  }

  // Активированные ключи
  for (const r of db.redeemedKeys || []) {
    await client.query(
      `INSERT INTO site_keys_state (key, uid, email, at) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING`,
      [r.key, r.uid ?? null, r.email ?? null, r.at ?? Date.now()]
    );
  }

  // VICEL-коды
  for (const c of db.codes || []) {
    await client.query(
      `INSERT INTO site_codes (code, days, used_by, used_at, created) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING`,
      [c.code, c.days, c.usedBy ?? null, c.usedAt ?? null, c.created ?? Date.now()]
    );
  }

  await client.end();
  console.log('[migrate] готово');
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
