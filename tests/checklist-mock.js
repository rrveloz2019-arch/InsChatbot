// UI test of the agent setup checklist with a SIMULATED Supabase (no real data touched).
// Needs app/ served at http://127.0.0.1:8770
const { chromium, devices } = require('playwright');
const BASE = 'http://127.0.0.1:8770', SB = 'https://vmauuwxeojbwlwcpvtxb.supabase.co';
let pass = 0, fail = 0; const ck = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

function mockSupabase(ctx, agent) {
  const user = { id: agent.id, aud: 'authenticated', role: 'authenticated', email: agent.email, factors: [], app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: agent.id, email: agent.email, role: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: now }], exp: now + 3600 })}.sig`;
  return ctx.route(SB + '/**', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/auth/v1/token') return json({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user });
    if (p === '/auth/v1/user') return json(user);
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (p === '/rest/v1/agents' && req.method() === 'GET') return json(agent);
    if (p === '/rest/v1/agents' && req.method() === 'PATCH') { Object.assign(agent, JSON.parse(req.postData())); return json(agent); }
    if (p === '/rest/v1/leads') return json([]);
    return json({});
  });
}

(async () => {
  const browser = await chromium.launch();
  const agent = { id: 'mock-1', slug: 'mock-agent', full_name: 'Mock Agent', email: 'mock@example.com', phone: null, license_no: null, booking_url: null, photo_path: null, role: 'agent', active: false, alerts_email: false, created_at: new Date().toISOString() };
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await mockSupabase(ctx, agent);
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(BASE + '/portal.html'); await pg.waitForSelector('#authView:not([hidden])');
  await pg.fill('#email', agent.email); await pg.fill('#password', 'x'); await pg.click('#authBtn');
  await pg.waitForSelector('#appView:not([hidden])');

  ck('New agent sees "Setup: 1 of 6 done" bar on leads page', await pg.isVisible('#setupBar') && (await pg.textContent('#setupBarText')).includes('1 of 6'));
  await pg.click('#setupBarGo');
  ck('"Finish setup" opens the checklist in Profile', await pg.isVisible('#checklist'));
  const titles = await pg.$$eval('#checklistItems li b', b => b.map(x => x.textContent));
  ck('Checklist has the 6 steps in order', titles.length === 6 && titles[0].includes('Confirm') && titles[5].includes('Share'), titles.join(' | '));
  ck('Only "Confirm your email" is checked at start', (await pg.$$eval('#checklistItems li.done', l => l.map(x => x.dataset.item))).join() === 'email');
  await pg.screenshot({ path: __dirname + '/../test-screenshots/19-checklist-start.png', fullPage: true });

  // step 3: phone + license via the form
  await pg.fill('#pPhone', '3055551234'); await pg.fill('#pLicense', 'FL-W123456'); await pg.click('#profileForm button[type=submit]');
  await pg.waitForFunction(() => document.querySelector('#checklistItems li[data-item="details"]').classList.contains('done'));
  ck('Saving phone + license checks off step 3', true);
  // step 4: alerts button
  await pg.click('#checklistItems li[data-item="alerts"] button');
  await pg.waitForFunction(() => document.querySelector('#checklistItems li[data-item="alerts"]').classList.contains('done'));
  ck('"Turn on" button checks off alerts (saved to profile)', agent.alerts_email === true);
  ck('Alerts step names the agent profile email', (await pg.textContent('#checklistItems li[data-item="alerts"]')).includes('mock@example.com'));
  // step 2: photo button opens file picker
  const [chooser] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 5000 }), pg.click('#checklistItems li[data-item="photo"] button')]);
  ck('"Add photo" opens the photo picker', !!chooser);
  // step 6: share
  await pg.click('#checklistItems li[data-item="share"] button');
  ck('"Go to my chatbot" opens the chatbot tab', await pg.isVisible('#tab-bot'));
  await pg.click('#copyLink').catch(() => {});
  await pg.click('#tabbtn-profile');
  await pg.waitForFunction(() => document.querySelector('#checklistItems li[data-item="share"]').classList.contains('done'));
  ck('Copying the link checks off step 6', true);
  ck('Approval step stays open until admin approves (agent cannot check it)', !(await pg.$eval('#checklistItems li[data-item="approved"]', l => l.classList.contains('done'))) && !(await pg.$('#checklistItems li[data-item="approved"] button')));
  ck('Counter now shows 4 of 6', (await pg.textContent('#checklistCount')) === '4 of 6 done');
  await pg.screenshot({ path: __dirname + '/../test-screenshots/20-checklist-progress.png', fullPage: true });

  // fully set-up agent: bar disappears
  Object.assign(agent, { photo_path: 'mock-1/p.jpg', active: true });
  await pg.reload(); await pg.waitForSelector('#appView:not([hidden])');
  ck('When all 6 are done, the setup bar disappears', !(await pg.isVisible('#setupBar')));

  // admin never sees the checklist bar
  const ctx2 = await browser.newContext(); await ctx2.route(/fonts\./, r => r.abort());
  await mockSupabase(ctx2, { ...agent, id: 'mock-admin', email: 'admin@example.com', role: 'admin', photo_path: null, alerts_email: false });
  const ap = await ctx2.newPage(); await ap.goto(BASE + '/portal.html'); await ap.waitForSelector('#authView:not([hidden])');
  await ap.fill('#email', 'admin@example.com'); await ap.fill('#password', 'x'); await ap.click('#authBtn'); await ap.waitForSelector('#appView:not([hidden])');
  ck('Admin does not get the agent setup bar', !(await ap.isVisible('#setupBar')));

  // phone width
  const m = await browser.newContext({ ...devices['iPhone 13'] }); await m.route(/fonts\./, r => r.abort());
  await mockSupabase(m, { ...agent, photo_path: null, active: false, alerts_email: false });
  const mp = await m.newPage(); await mp.goto(BASE + '/portal.html'); await mp.waitForSelector('#authView:not([hidden])');
  await mp.fill('#email', agent.email); await mp.fill('#password', 'x'); await mp.click('#authBtn'); await mp.waitForSelector('#appView:not([hidden])');
  await mp.click('#tabbtn-profile');
  ck('Checklist fits a phone screen', !(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await mp.screenshot({ path: __dirname + '/../test-screenshots/21-checklist-phone.png' });

  ck('No JavaScript errors', errs.length === 0, errs.join(' | '));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(2); });
