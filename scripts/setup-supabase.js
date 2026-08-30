// Создаёт таблицы сайта в Supabase. Запуск: node scripts/setup-supabase.js
require('dotenv').config();
const { Client } = require('pg');

const DDL = [
  `CREATE TABLE IF NOT EXISTS site_users (
    id text PRIMARY KEY,
    uid int UNIQUE,
    nick text UNIQUE NOT NULL,
    email text UNIQUE NOT NULL,
    pass_hash text NOT NULL,
    created bigint NOT NULL DEFAULT 0,
    is_admin boolean DEFAULT false,
    banned boolean DEFAULT false,
    avatar text,
    plan text DEFAULT 'free',
    plan_expires_at bigint
  )`,
  `CREATE TABLE IF NOT EXISTS site_sessions (
    sid text PRIMARY KEY,
    user_id text NOT NULL,
    expires_at bigint NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_site_sessions_user ON site_sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS site_otp (
    id text PRIMARY KEY,
    purpose text NOT NULL,
    email text,
    pending jsonb,
    user_id text,
    code_hash text NOT NULL,
    salt text NOT NULL,
    attempts int NOT NULL DEFAULT 0,
    expires_at bigint NOT NULL,
    last_sent_at bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_topics (
    id text PRIMARY KEY,
    title text NOT NULL,
    author text NOT NULL,
    author_email text NOT NULL,
    created bigint NOT NULL,
    posts jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_codes (
    code text PRIMARY KEY,
    days int NOT NULL,
    used_by text,
    used_at bigint,
    created bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_keys_state (
    key text PRIMARY KEY,
    uid int,
    email text,
    at bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_bans (
    type text NOT NULL,
    value text NOT NULL,
    PRIMARY KEY (type, value)
  )`,
];

(async () => {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  for (const sql of DDL) {
    await client.query(sql);
  }
  console.log('[DDL] OK: ' + DDL.length + ' statements');
  await client.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
