// Загружает VicelLoader.exe в Supabase (site_files). Запуск: node scripts/upload-loader.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const exe = path.join(__dirname, '..', 'tgbot', 'data', 'VicelLoader.exe');
  if (!fs.existsSync(exe)) {
    console.error('Файл не найден:', exe);
    process.exit(1);
  }
  const buf = fs.readFileSync(exe);
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query(
    `CREATE TABLE IF NOT EXISTS site_files (
       name text PRIMARY KEY,
       data bytea NOT NULL,
       updated_at bigint NOT NULL
     )`);
  await client.query(
    `INSERT INTO site_files (name, data, updated_at) VALUES ('loader', $1, $2)
     ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [buf, Date.now()]);
  await client.end();
  console.log('[upload] loader: ' + buf.length + ' bytes → site_files');
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
