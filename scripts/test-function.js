// E2E-тест бэкенда (src/server.js) — как его видит Netlify.
const http = require('http');
const crypto = require('crypto');
const { Client } = require('pg');
require('dotenv').config();

const { app } = require('../src/server');

const PORT = 3002;
let cookieJar = {};

function cookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}
function saveCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const line of set) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) cookieJar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}
async function req(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': cookieJar['vicel_csrf'] || '',
      Cookie: cookieHeader(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  saveCookies(res);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 200) }; }
  return { status: res.status, data, text };
}

let failed = 0;
function check(name, cond) {
  console.log((cond ? '[PASS] ' : '[FAIL] ') + name);
  if (!cond) failed++;
}

async function main() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(PORT, r));

  // 1. health + csrf
  const h = await req('GET', '/api/health');
  check('health', h.status === 200 && h.data.ok);
  await req('GET', '/api/auth/csrf');

  // очистка от прошлых запусков
  const pc = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pc.connect();
  await pc.query(`DELETE FROM site_sessions WHERE user_id IN (SELECT id FROM site_users WHERE nick='e2etest')`);
  await pc.query(`DELETE FROM site_topics WHERE author_email='e2e@vicel.work'`);
  await pc.query(`DELETE FROM site_keys_state WHERE email='e2e@vicel.work'`);
  await pc.query(`DELETE FROM site_otp WHERE email='e2e@vicel.work'`);
  await pc.query(`DELETE FROM site_users WHERE nick='e2etest'`);

  // 2. register
  const reg = await req('POST', '/api/auth/register', {
    nick: 'e2etest', email: 'e2e@vicel.work', password: 'Password1', confirm: 'Password1',
  });
  if (reg.status !== 200) console.log('[DEBUG register]', reg.status, reg.text.slice(0, 200));
  check('register', reg.status === 200 && !!reg.data.challengeId);
  const challengeId = reg.data.challengeId;

  // 3. эмулируем получение кода из письма
  await new Promise(r => setTimeout(r, 1500));
  const salt = crypto.randomBytes(16).toString('hex');
  const code = '135790';
  const hash = crypto.createHash('sha256').update(salt + code).digest('hex');
  await pc.query(`UPDATE site_otp SET code_hash=$1, salt=$2 WHERE id=$3`, [hash, salt, challengeId]);

  // 4. verify
  const vf = await req('POST', '/api/auth/verify', { challengeId, code });
  if (vf.status !== 200) console.log('[DEBUG verify]', vf.status, vf.text.slice(0, 200));
  check('verify', vf.status === 200 && vf.data.user && vf.data.user.nick === 'e2etest');
  check('UID выдан', typeof vf.data.user?.uid === 'number');
  const myUid = vf.data.user?.uid;

  // 5. me
  const me = await req('GET', '/api/auth/me');
  check('me', me.status === 200 && me.data.user?.email === 'e2e@vicel.work');

  // 6. форум: создание
  const ct = await req('POST', '/api/forum/topics', { title: 'Общий чат', text: 'Тестовое сообщение E2E, проверка форума.' });
  console.log('[DEBUG create]', ct.status, ct.text.slice(0, 300));
  check('форум: создание темы', ct.status === 200 && !!ct.data.topic);
  const topicId = ct.data.topic?.id;

  // 7. форум: чтение темы
  if (topicId) {
    const gt = await req('GET', `/api/forum/topics/${topicId}`);
    check('форум: тема читается', gt.status === 200 && gt.data.topic?.posts?.length === 1);

    // 8. ответ в теме
    const rp = await req('POST', `/api/forum/topics/${topicId}/reply`, { text: 'Ответ E2E' });
    check('форум: ответ', rp.status === 200);
    const gt2 = await req('GET', `/api/forum/topics/${topicId}`);
    check('форум: ответ виден', gt2.data.topic?.posts?.length === 2);
  }

  // 9. активность
  const act = await req('GET', '/api/forum/my-activity');
  if (act.status !== 200 || !act.data.activity?.length) {
    console.log('[DEBUG activity]', act.status, act.text.slice(0, 300));
  }
  check('профиль: активность', act.status === 200 && act.data.activity?.length >= 1);

  // 10. удаление без админки запрещено
  if (topicId) {
    const del = await req('POST', `/api/forum/topics/${topicId}/delete`);
    check('форум: удаление без админки 403', del.status === 403);
  }

  // 11. активация ключа из базы бота
  const fk = await pc.query(
    `SELECT key_code, duration_days FROM keys
     WHERE hwid IS NULL AND is_active = true AND expires_at > now()
       AND key_code NOT IN (SELECT key FROM site_keys_state) LIMIT 1`);
  if (fk.rows[0]) {
    const rd = await req('POST', '/api/subscription/redeem-key', { key: fk.rows[0].key_code });
    check('подписка: ключ активирован', rd.status === 200 && rd.data.user?.plan === 'premium');
    const rd2 = await req('POST', '/api/subscription/redeem-key', { key: fk.rows[0].key_code });
    check('подписка: повтор отклонён', rd2.data.ok === false);
  } else {
    console.log('[SKIP] нет свободного ключа');
  }

  // 12. админ-действия без прав
  const sa = await req('POST', '/api/admin/set-admin', { uid: myUid, admin: true });
  check('админка: без прав 403', sa.status === 403);

  // 13. аватарка
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const av = await req('POST', '/api/auth/avatar', { data: png });
  check('аватарка: загрузка', av.status === 200 && !!av.data.user?.avatar);
  if (av.data.user?.avatar) {
    const avGet = await fetch(`http://127.0.0.1:${PORT}${av.data.user.avatar}`);
    check('аватарка: раздача', avGet.status === 200);
  }

  // 14. смена пароля
  const cp = await req('POST', '/api/auth/change-password', { currentPassword: 'Password1', newPassword: 'Password2' });
  check('профиль: смена пароля', cp.status === 200);

  // 15. logout
  const lo = await req('POST', '/api/auth/logout');
  const me2 = await req('GET', '/api/auth/me');
  check('logout', lo.status === 200 && me2.data.user === null);

  // 16. повторный вход
  await new Promise(r => setTimeout(r, 2500));
  const lg = await req('POST', '/api/auth/login', { login: 'e2etest', password: 'Password2' });
  if (lg.status !== 200) console.log('[DEBUG login]', lg.status, lg.text.slice(0, 200));
  check('login', lg.status === 200 && !!lg.data.challengeId);
  if (lg.data.challengeId) {
    const salt2 = crypto.randomBytes(16).toString('hex');
    const code2 = '246810';
    const hash2 = crypto.createHash('sha256').update(salt2 + code2).digest('hex');
    await pc.query(`UPDATE site_otp SET code_hash=$1, salt=$2 WHERE id=$3`, [hash2, salt2, lg.data.challengeId]);
    const vf2 = await req('POST', '/api/auth/verify', { challengeId: lg.data.challengeId, code: code2, purpose: 'login' });
    check('login: verify', vf2.status === 200 && vf2.data.user?.nick === 'e2etest');
  }

  // 17. чистим тестовые данные
  await pc.query(`DELETE FROM site_sessions WHERE user_id IN (SELECT id FROM site_users WHERE nick='e2etest')`);
  await pc.query(`DELETE FROM site_topics WHERE author_email='e2e@vicel.work'`);
  await pc.query(`DELETE FROM site_keys_state WHERE email='e2e@vicel.work'`);
  await pc.query(`DELETE FROM site_otp WHERE email='e2e@vicel.work'`);
  await pc.query(`DELETE FROM site_users WHERE nick='e2etest'`);
  await pc.end();
  server.close();

  console.log(failed === 0 ? '\n=== ALL TESTS PASSED ===' : `\n=== FAILED: ${failed} ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('E2E ERR:', e); process.exit(1); });
