// End-to-end test against the LIVE Supabase project.
// Needs: app/ served at http://127.0.0.1:8770 and the zz-e2e-* test accounts.
// Usage: node tests/e2e-live.js /path/to/jsQR.js
const { chromium, devices } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8770';
const PW = process.env.E2E_PASSWORD;          // never commit test passwords
if (!PW) { console.error('Set E2E_PASSWORD to the test accounts\' password.'); process.exit(2); }
const SHOTS = __dirname + '/../test-screenshots';
const JSQR = fs.readFileSync(process.argv[2], 'utf8');
let pass = 0, fail = 0;
const ck = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };

function totp(secretB32) {                                   // RFC 6238, 30s, 6 digits
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const ch of secretB32.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', key).update(ctr).digest(); const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
async function chatFlow(page, slug, { lang = 'en', hh, income, coverage = 'none', priority, name, phone }) {
  await page.goto(`${BASE}/chat.html?agent=${slug}`);
  await page.waitForSelector('.opts button[data-value="go"]');
  if (lang === 'es') { await page.click('.lang button[data-lang="es"]'); await page.waitForSelector('.opts button[data-value="go"]'); }
  await page.click('.opts button[data-value="go"]');
  await page.fill('input[name="zip"]', '33101'); await page.press('input[name="zip"]', 'Enter');
  await page.click(`.opts button[data-value="${hh}"]`);
  await page.fill('input[name="income"]', String(income)); await page.press('input[name="income"]', 'Enter');
  await page.click(`.opts button[data-value="${coverage}"]`);
  await page.click(`.opts button[data-value="${priority}"]`);
  await page.fill('input[name="fname"]', name); await page.fill('input[name="phone"]', phone);
  await page.check('input[name="consent"]'); await page.click('form.contact button[type="submit"]');
  await page.waitForSelector('#resultGroup', { timeout: 15000 });
  return page.getAttribute('#resultGroup', 'data-group');
}
async function login(page, email) {
  await page.goto(`${BASE}/portal.html`);
  await page.waitForSelector('#authView:not([hidden]), #appView:not([hidden])');
  if (await page.isVisible('#appView')) { await page.click('#logout'); await page.waitForSelector('#authView:not([hidden])'); }
  await page.fill('#email', email); await page.fill('#password', PW); await page.click('#authBtn');
}
async function decodeQR(page) {
  await page.waitForFunction(() => document.getElementById('qrImg').src.startsWith('data:image/png'), null, { timeout: 15000 });
  await page.addScriptTag({ content: JSQR });
  return page.evaluate(async () => { const im = document.getElementById('qrImg'); await im.decode();
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height); const r = jsQR(d.data, c.width, c.height); return r && r.data; });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());       // fonts blocked in this sandbox only
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));

  // ---------- 1. CHATBOT (public) ----------
  let g = await chatFlow(page, 'test-agent-uno', { hh: 1, income: 20000, priority: 'lowpay', name: 'Rosa E2E', phone: '3055551001' });
  ck('Chatbot loads agent from database (name in header)', (await page.textContent('#title')) && (await page.textContent('#agentLine')).includes('Test Agent Uno'));
  ck('Lead saved; group decided by SERVER = G1', g === 'G1', 'got ' + g);
  ck('Consent text names the agent + license', (await page.textContent('.chat')).includes('Test Agent Uno will contact you'));
  await page.screenshot({ path: `${SHOTS}/11-live-chat-result.png`, fullPage: true });
  g = await chatFlow(page, 'test-agent-uno', { hh: 1, income: 20000, priority: 'lowpay', name: 'Rosa E2E', phone: '3055551001' });
  ck('Same phone again is recognized as duplicate', (await page.textContent('.chat')).includes('already have your information'));
  g = await chatFlow(page, 'test-agent-uno', { lang: 'es', hh: 2, income: 40000, priority: 'lowded', name: 'Luis E2E', phone: '3055551002' });
  ck('Spanish lead saved; server group G2', g === 'G2' && (await page.textContent('.chat')).includes('Grupo 2'));
  await page.goto(`${BASE}/chat.html?agent=test-pending-dos`); await page.waitForSelector('#unavailable');
  ck('Chatbot link of a NOT-approved agent shows "not active"', await page.isVisible('#unavailable'));
  await page.goto(`${BASE}/chat.html?agent=does-not-exist`); await page.waitForSelector('#unavailable');
  ck('Unknown chatbot link shows "not active"', await page.isVisible('#unavailable'));

  // ---------- 2. AGENT PORTAL ----------
  await page.goto(`${BASE}/portal.html`); await page.waitForSelector('#authView:not([hidden]), #appView:not([hidden])');
  if (await page.isVisible('#appView')) { await page.click('#logout'); }
  await page.fill('#email', 'zz-e2e-agent@example.com'); await page.fill('#password', 'wrong-password'); await page.click('#authBtn');
  await page.waitForFunction(() => document.getElementById('authMsg').textContent.length > 0);
  ck('Wrong password is rejected', (await page.textContent('#authMsg')).includes('incorrect'));
  await page.fill('#password', PW); await page.click('#authBtn');
  await page.waitForSelector('#appView:not([hidden])'); await page.waitForSelector('#leadTable tr[data-id]');
  ck('Agent signs in with real account', (await page.textContent('#whoName')) === 'Test Agent Uno');
  const rows = await page.$$eval('#leadTable tr[data-id]', r => r.length);
  ck('Agent sees the 2 leads from the chatbot', rows === 2, 'rows=' + rows);
  const first = await page.getAttribute('#leadTable tr[data-id]:has-text("Rosa E2E")', 'data-id');
  await page.selectOption(`#leadTable tr[data-id="${first}"] select`, 'called');
  await page.waitForSelector('.toast');
  await page.reload(); await page.waitForSelector(`#leadTable tr[data-id="${first}"]`);
  ck('Status change is saved in the database', await page.$eval(`#leadTable tr[data-id="${first}"] select`, s => s.value) === 'called');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ck('CSV download has header + 2 leads with consent text', csv.split('\n').length === 3 && csv.includes('consent_text') && csv.includes('Rosa E2E'));
  await page.screenshot({ path: `${SHOTS}/12-live-portal-leads.png`, fullPage: true });

  // chatbot tab + QR (initials)
  await page.click('#tabbtn-bot');
  const link = await page.inputValue('#botLink');
  ck('Agent link is chat.html?agent=test-agent-uno', link === `${BASE}/chat.html?agent=test-agent-uno`);
  ck('QR (initials) scans to the agent link', (await decodeQR(page)) === link);

  // profile: validation + photo upload
  await page.click('#tabbtn-profile');
  await page.fill('#pBooking', 'http://not-secure.com'); await page.click('#profileForm button[type=submit]');
  ck('Booking link must be https', (await page.textContent('#profileMsg')).includes('https://'));
  await page.fill('#pBooking', 'https://calendly.com/test-agent-uno'); await page.fill('#pPhone', '(305) 555-7777');
  await page.click('#profileForm button[type=submit]'); await page.waitForFunction(() => document.getElementById('profileMsg').textContent.startsWith('Saved'));
  ck('Profile saved to database', true);
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 500; c.height = 600; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 500, 600); g.addColorStop(0, '#d9a066'); g.addColorStop(1, '#5a3d2b'); x.fillStyle = g; x.fillRect(0, 0, 500, 600);
    x.fillStyle = '#f1d3b3'; x.beginPath(); x.arc(250, 260, 140, 0, 7); x.fill(); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('#pPhoto', { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => /Photo saved|failed|Could not/.test(document.getElementById('profileMsg').textContent), null, { timeout: 20000 });
  ck('Photo uploaded to Supabase Storage', (await page.textContent('#profileMsg')).includes('Photo saved'), await page.textContent('#profileMsg'));
  await page.setInputFiles('#pPhoto', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  ck('Non-image file rejected', (await page.textContent('#profileMsg')).includes('JPG, PNG'));
  await page.click('#tabbtn-bot');
  await page.waitForTimeout(1500);
  ck('QR with the uploaded PHOTO still scans', (await decodeQR(page)) === link);
  await page.locator('#qrImg').screenshot({ path: `${SHOTS}/13-live-qr-photo.png` });
  const chatPage = await ctx.newPage();
  await chatPage.goto(link); await chatPage.waitForSelector('#agentPic img');
  const imgOk = await chatPage.$eval('#agentPic img', i => i.complete && i.naturalWidth > 0);
  ck('Chatbot header shows the agent photo', imgOk);
  ck('Chatbot shows updated phone + booking link', (await chatPage.textContent('#agentLine')).includes('(305) 555-7777'));
  await chatPage.screenshot({ path: `${SHOTS}/14-live-chat-with-photo.png` }); await chatPage.close();

  // 2-step verification
  await page.click('#tabbtn-profile'); await page.waitForFunction(() => document.getElementById('mfaToggle').textContent.length > 0);
  await page.click('#mfaToggle'); await page.waitForSelector('#mfaEnroll:not([hidden])');
  const secret = (await page.textContent('#mfaSecret')).trim();
  await page.fill('#mfaEnrollCode', '000000'); await page.click('#mfaEnrollVerify');
  await page.waitForFunction(() => document.getElementById('secMsg').textContent.length > 0);
  ck('Wrong 2-step setup code rejected', (await page.textContent('#secMsg')).includes("didn't work"));
  await page.fill('#mfaEnrollCode', totp(secret)); await page.click('#mfaEnrollVerify');
  await page.waitForFunction(() => document.getElementById('secMsg').textContent.includes('is on'));
  ck('2-step verification turned on', true);
  await page.click('#logout'); await page.waitForSelector('#authView:not([hidden])');
  await page.fill('#email', 'zz-e2e-agent@example.com'); await page.fill('#password', PW); await page.click('#authBtn');
  await page.waitForSelector('#mfaView:not([hidden])');
  ck('Sign-in now asks for the 6-digit code', await page.isVisible('#mfaView'));
  await page.fill('#mfaCode', '123456'); await page.click('#mfaForm button[type=submit]');
  await page.waitForFunction(() => document.getElementById('mfaMsg').textContent.length > 0);
  ck('Wrong code blocks sign-in', await page.isVisible('#mfaView') && !(await page.isVisible('#appView')));
  await page.fill('#mfaCode', totp(secret)); await page.click('#mfaForm button[type=submit]');
  await page.waitForSelector('#appView:not([hidden])');
  ck('Correct code signs in', await page.isVisible('#appView'));
  await page.click('#tabbtn-profile'); await page.waitForFunction(() => document.getElementById('mfaToggle').textContent.includes('Turn off'));
  await page.click('#mfaToggle'); await page.waitForFunction(() => document.getElementById('secMsg').textContent.includes('is off'));
  ck('2-step verification turned off again (cleanup)', true);

  // ---------- 3. PENDING AGENT ----------
  await page.click('#logout'); await page.waitForSelector('#authView:not([hidden])');
  await page.fill('#email', 'zz-e2e-pending@example.com'); await page.fill('#password', PW); await page.click('#authBtn');
  await page.waitForSelector('#appView:not([hidden])');
  await page.waitForSelector('#leadTable tr');
  ck('Pending agent sees "waiting for approval" banner', await page.isVisible('#pendingBanner'));
  ck('Pending agent sees NO leads of other agents', (await page.$$eval('#leadTable tr[data-id]', r => r.length)) === 0);

  // ---------- 4. ADMIN ----------
  await page.click('#logout'); await page.waitForSelector('#authView:not([hidden])');
  await page.fill('#email', 'zz-e2e-admin@example.com'); await page.fill('#password', PW); await page.click('#authBtn');
  await page.waitForSelector('#appView:not([hidden])'); await page.waitForSelector('#agentTable tr[data-id]');
  ck('Admin sees the agents table', (await page.$$eval('#agentTable tr[data-id]', r => r.length)) === 2);
  await page.click('#agentTable tr:has-text("Test Pending Dos") .toggle');
  await page.waitForFunction(() => document.getElementById('adminMsg').textContent.length > 0);
  ck('Admin cannot activate agent without license #', (await page.textContent('#adminMsg')).includes('license'));
  await page.click('#agentTable tr:has-text("Test Agent Uno") .toggle');
  await page.waitForFunction(() => document.getElementById('adminMsg').textContent.includes('deactivated'));
  const p2 = await ctx.newPage(); await p2.goto(`${BASE}/chat.html?agent=test-agent-uno`); await p2.waitForSelector('#unavailable');
  ck('Deactivated agent\'s chatbot goes offline immediately', await p2.isVisible('#unavailable')); await p2.close();
  await page.click('#agentTable tr:has-text("Test Agent Uno") .toggle');
  await page.waitForFunction(() => document.getElementById('adminMsg').textContent.includes('activated. Their'));
  ck('Admin re-activates the agent', true);
  await page.screenshot({ path: `${SHOTS}/15-live-admin.png`, fullPage: true });
  await page.click('#tabbtn-leads'); await page.waitForSelector('#leadTable tr[data-id]');
  ck('Admin sees all leads with agent name', (await page.textContent('#leadTable')).includes('Test Agent Uno'));

  // ---------- 5. cleanup photo (as agent) + mobile ----------
  await page.click('#logout'); await page.waitForSelector('#authView:not([hidden])');
  await page.fill('#email', 'zz-e2e-agent@example.com'); await page.fill('#password', PW); await page.click('#authBtn');
  await page.waitForSelector('#appView:not([hidden])');
  await page.click('#tabbtn-profile'); await page.click('#pPhotoRemove');
  await page.waitForFunction(() => document.getElementById('profileMsg').textContent.includes('removed'));
  ck('Photo removed from storage (cleanup)', true);
  for (const scheme of ['light', 'dark']) {
    const m = await browser.newContext({ ...devices['iPhone 13'], colorScheme: scheme }); await m.route(/fonts\./, r => r.abort());
    const mp = await m.newPage(); await mp.goto(`${BASE}/chat.html?agent=test-agent-uno`); await mp.waitForSelector('.opts');
    const o1 = await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await mp.goto(`${BASE}/portal.html`); await mp.waitForSelector('#authView:not([hidden])');
    await mp.fill('#email', 'zz-e2e-agent@example.com'); await mp.fill('#password', PW); await mp.click('#authBtn'); await mp.waitForSelector('#leadTable tr[data-id]');
    const o2 = await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    ck(`Phone ${scheme}: chatbot + portal fit the screen`, !o1 && !o2);
    if (scheme === 'light') await mp.screenshot({ path: `${SHOTS}/16-live-portal-mobile.png` });
    await m.close();
  }
  ck('No JavaScript errors', errs.length === 0, errs.join(' | '));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASHED:', e.message); process.exit(2); });
