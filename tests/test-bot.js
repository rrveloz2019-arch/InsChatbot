const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8765';
const SHOTS = '/home/user/aca-lead-bot/test-screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

async function runFlow(page, { lang = 'en', zip = '33101', hh, income, coverage = 'none', priority, name = 'Test', phone = '3055550123', consent = true }) {
  await page.goto(BASE + '/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  if (lang === 'es') await page.click('.lang button[data-lang="es"]');
  await page.click('.opts button[data-value="go"]');
  await page.fill('input[name="zip"]', zip); await page.press('input[name="zip"]', 'Enter');
  await page.click(`.opts button[data-value="${hh}"]`);
  await page.fill('input[name="income"]', String(income)); await page.press('input[name="income"]', 'Enter');
  await page.click(`.opts button[data-value="${coverage}"]`);
  await page.click(`.opts button[data-value="${priority}"]`);
  await page.fill('input[name="fname"]', name);
  await page.fill('input[name="phone"]', phone);
  if (consent) await page.check('input[name="consent"]');
  await page.click('form.contact button[type="submit"]');
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1000, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));

  // FPL 2026: 1p=$15,960  2p=$21,640  4p=$33,000
  const cases = [
    { label: 'Group 1 ($0 premium): 1 person, $20,000 (125% FPL), lowest payment', hh: 1, income: 20000, priority: 'lowpay', want: 'G1' },
    { label: 'Group 2 (low deductible): 2 people, $40,000 (185% FPL), low deductible', hh: 2, income: 40000, priority: 'lowded', want: 'G2' },
    { label: 'Group 3 (check-ups): 1 person, $70,000, check-ups', hh: 1, income: 70000, priority: 'checkups', want: 'G3' },
    { label: 'Group 4 (borderline): 4 people, $140,000 (424% FPL), balance', hh: 4, income: 140000, priority: 'balance', want: 'G4' },
    { label: 'Group 4: 1 person, $45,000 (282% FPL), lowest payment', hh: 1, income: 45000, priority: 'lowpay', want: 'G4' },
    { label: 'FL coverage gap: 1 person, $12,000 (75% FPL)', hh: 1, income: 12000, priority: 'lowpay', want: 'GAP' },
    { label: 'Review: has employer coverage', hh: 2, income: 30000, coverage: 'employer', priority: 'lowpay', want: 'REVIEW' },
  ];
  for (const c of cases) {
    await runFlow(page, c);
    const g = await page.getAttribute('#resultGroup', 'data-group');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aca_leads_v1') || '[]'));
    check(c.label, g === c.want && stored.length === 1 && stored[0].group === c.want, `→ got ${g}`);
  }
  // Group 4 >400% note
  await runFlow(page, cases[3]);
  check('Group 4 above 400% FPL shows "no tax credit" note', (await page.textContent('#chat')).includes('above 400%'));
  await page.screenshot({ path: `${SHOTS}/01-desktop-group4.png`, fullPage: true });

  // Consent record stored
  await runFlow(page, cases[0]);
  const lead = (await page.evaluate(() => JSON.parse(localStorage.getItem('aca_leads_v1'))))[0];
  check('Consent stored with timestamp + exact text naming agency & agent',
    lead.consent === true && !!lead.consentAt && lead.consentText.includes('Sample Health Agency') && lead.consentText.includes('Jane Doe'));
  check('FPL % calculated correctly (20000/15960 = 125%)', lead.fplPct === 125, `got ${lead.fplPct}`);
  check('No SSN / medical fields collected', !Object.keys(lead).some(k => /ssn|condition|medic(ation|al)/i.test(k)));

  // CSV download
  await page.click('#admin summary');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check('CSV download has header + 1 lead row', csv.split('\n').length === 2 && csv.startsWith('createdAt,group'));
  await page.screenshot({ path: `${SHOTS}/02-desktop-agent-view.png`, fullPage: true });

  // Validation: bad ZIP
  await page.goto(BASE + '/index.html'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('.opts button[data-value="go"]');
  await page.fill('input[name="zip"]', '90210'); await page.press('input[name="zip"]', 'Enter');
  check('Non-Florida ZIP (90210) rejected', (await page.textContent('.err')).includes('Florida ZIP'));

  // Validation: no consent -> no lead
  await runFlow(page, { ...cases[0], consent: false });
  const n = await page.evaluate(() => JSON.parse(localStorage.getItem('aca_leads_v1') || '[]').length);
  check('Without consent checkbox: error shown and NO lead saved', n === 0 && (await page.textContent('form.contact .err')).length > 0);
  // Validation: short phone
  await runFlow(page, { ...cases[0], phone: '12345' });
  check('Invalid phone (5 digits) rejected', await page.evaluate(() => JSON.parse(localStorage.getItem('aca_leads_v1') || '[]').length) === 0);

  // Spanish
  await runFlow(page, { ...cases[1], lang: 'es' });
  const es = await page.textContent('#chat');
  check('Spanish flow works (Grupo 2 + Spanish consent)', es.includes('Grupo 2') && (await page.evaluate(() => JSON.parse(localStorage.getItem('aca_leads_v1'))[0].consentText)).startsWith('Al marcar'));
  check('Spanish disclaimer says not a government site', (await page.textContent('#disclaimer')).includes('no es un sitio web del gobierno'));

  // Google Sheet send (mock endpoint)
  const html = fs.readFileSync('/home/user/aca-lead-bot/index.html', 'utf8').replace('sheetEndpoint: ""', 'sheetEndpoint: "https://script.google.com/macros/s/TEST/exec"');
  fs.writeFileSync('/tmp/claude-0/-home-user/33099025-bf4c-5bbe-a50c-3aa20a503fd0/scratchpad/site/index-sheet.html', html);
  let posted = null;
  await page.route('https://script.google.com/**', async r => { posted = r.request().postData(); await r.fulfill({ status: 200, body: '{"status":"ok"}' }); });
  await page.goto(BASE + '/index-sheet.html'); await page.evaluate(() => localStorage.clear());
  await page.click('.opts button[data-value="go"]');
  await page.fill('input[name="zip"]', '32801'); await page.press('input[name="zip"]', 'Enter');
  await page.click('.opts button[data-value="1"]');
  await page.fill('input[name="income"]', '20000'); await page.press('input[name="income"]', 'Enter');
  await page.click('.opts button[data-value="none"]'); await page.click('.opts button[data-value="lowpay"]');
  await page.fill('input[name="fname"]', 'Sheet'); await page.fill('input[name="phone"]', '(407) 555-0199');
  await page.check('input[name="consent"]'); await page.click('form.contact button[type="submit"]');
  await page.waitForSelector('#resultGroup');
  const body = posted ? JSON.parse(posted) : {};
  check('Lead POSTed to Google Sheet endpoint with consent + group', body.consent === true && body.group === 'G1' && body.phone === '4075550199');

  // Mobile
  const m = await browser.newContext({ ...require('playwright').devices['iPhone 13'] });
  const mp = await m.newPage();
  await runFlow(mp, cases[0]);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('Phone width (iPhone 13): no horizontal scroll', !overflow);
  await mp.screenshot({ path: `${SHOTS}/03-mobile-group1.png`, fullPage: true });
  await runFlow(mp, { ...cases[1], lang: 'es' });
  await mp.screenshot({ path: `${SHOTS}/04-mobile-spanish-group2.png`, fullPage: true });

  check('No JavaScript errors on page', errors.length === 0, errors.join(' | '));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
