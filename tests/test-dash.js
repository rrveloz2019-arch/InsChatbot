const {chromium,devices}=require('playwright');
let p=0,f=0;const ck=(n,c,x='')=>{c?p++:f++;console.log((c?'PASS ':'FAIL ')+n+(x?'  '+x:''))};
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1200,height:900}}); await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',r=>r.fulfill({contentType:'application/javascript',body:require('fs').readFileSync('npmqr/package/qrcode.js','utf8')}));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
const pg=await ctx.newPage();
const errs=[]; pg.on('pageerror',e=>errs.push(e.message)); pg.on('console',m=>{if(m.type()==='error'&&!/ERR_(TUNNEL|FAILED)/.test(m.text()))errs.push(m.text())});
const U='http://127.0.0.1:8767/';
await pg.goto(U); await pg.evaluate(()=>localStorage.clear()); await pg.reload();
// agent login
await pg.click('#signin');
ck('Only the selected tab panel is visible', await pg.isVisible('#tab-leads') && !(await pg.isVisible('#tab-bot')) && !(await pg.isVisible('#tab-profile')) && !(await pg.isVisible('#tab-admin')));
ck('Agent Maria signs in', await pg.isVisible('#appView') && (await pg.textContent('#whoName'))==='Maria Lopez');
const rows=await pg.$$eval('#leadTable tr[data-id]',r=>r.length);
ck('Agent sees ONLY her 10 leads (not James\'s 3)', rows===10, 'rows='+rows);
await pg.click('.chip[data-g="G2"]'); ck('Group 2 filter shows 3', (await pg.$$eval('#leadTable tr[data-id]',r=>r.length))===3);
await pg.click('.chip[data-g=""]');
await pg.selectOption('#statusFilter','enrolled'); ck('Status filter Enrolled shows 2', (await pg.$$eval('#leadTable tr[data-id]',r=>r.length))===2);
await pg.selectOption('#statusFilter',''); await pg.fill('#search','Rosa'); ck('Search by name works', (await pg.$$eval('#leadTable tr[data-id]',r=>r.length))===1);
await pg.fill('#search','');
await pg.selectOption('#leadTable tr[data-id="l1"] select','called');
await pg.reload(); await pg.click('#signin');
ck('Status change saved (Rosa → Called)', await pg.$eval('#leadTable tr[data-id="l1"] select',s=>s.value)==='called');
await pg.click('#simulate'); ck('Simulated new lead appears + alert toast', (await pg.$$eval('#leadTable tr[data-id]',r=>r.length))===11 && (await pg.locator('.toast').last().textContent()).includes('maria.lopez@example.com'));
await pg.screenshot({path:'/home/user/aca-lead-bot/test-screenshots/05-dashboard-agent-leads.png',fullPage:true});
// chatbot tab
await pg.click('#tabbtn-bot');
ck('Chatbot tab hides leads tab', !(await pg.isVisible('#tab-leads')) && await pg.isVisible('#tab-bot'));
ck('Chatbot link is unique to agent', (await pg.inputValue('#botLink')).endsWith('?agent=maria-lopez'));
await pg.waitForFunction(()=>document.getElementById('qrImg').src.startsWith('data:image/png'));
await pg.addScriptTag({content:require('fs').readFileSync('npmqr/jsqr/package/dist/jsQR.js','utf8')});
const decode=()=>pg.evaluate(async()=>{const im=document.getElementById('qrImg');await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const x=c.getContext('2d');x.drawImage(im,0,0);const d=x.getImageData(0,0,c.width,c.height);const r=jsQR(d.data,c.width,c.height);return r&&r.data;});
const link=await pg.inputValue('#botLink');
let dec=await decode(); ck('QR with initials badge SCANS to agent link', dec===link, 'decoded='+dec);
// upload a busy, high-contrast test photo (worst case for scanning)
const png=await pg.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=800;const x=c.getContext('2d');for(let i=0;i<4000;i++){x.fillStyle=`hsl(${Math.random()*360},80%,${Math.random()*100}%)`;x.fillRect(Math.random()*600,Math.random()*800,30,30);}return c.toDataURL('image/png').split(',')[1];});
await pg.click('#tabbtn-profile');
await pg.setInputFiles('#pPhoto',{name:'me.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
await pg.waitForFunction(()=>document.getElementById('profileMsg').textContent.includes('Photo saved'));
ck('Photo upload saved + shows in profile and top avatar', await pg.isVisible('#pPhotoPreview') && await pg.$('#avatar img')!==null);
await pg.setInputFiles('#pPhoto',{name:'x.txt',mimeType:'text/plain',buffer:Buffer.from('hello')});
ck('Non-image file rejected', (await pg.textContent('#profileMsg')).includes('JPG, PNG'));
await pg.click('#tabbtn-bot');
await pg.waitForFunction(()=>document.getElementById('qrImg').src.startsWith('data:image/png'));
await pg.waitForTimeout(300);
dec=await decode(); ck('QR with agent PHOTO still SCANS to agent link', dec===link, 'decoded='+dec);
await pg.locator('#qrImg').screenshot({path:'/home/user/aca-lead-bot/test-screenshots/10-qr-with-photo.png'});
await pg.screenshot({path:'/home/user/aca-lead-bot/test-screenshots/06-dashboard-chatbot.png',fullPage:true});
// profile
await pg.click('#tabbtn-profile');
await pg.fill('#pPhone','123'); await pg.click('#profileForm button[type=submit]');
ck('Profile rejects bad phone', (await pg.textContent('#profileMsg')).includes('10-digit'));
await pg.fill('#pPhone','3055559999'); await pg.fill('#pLicense',''); await pg.click('#profileForm button[type=submit]');
ck('Profile requires FL license #', (await pg.textContent('#profileMsg')).includes('license'));
await pg.fill('#pLicense','FL-A123456'); await pg.fill('#pName','Maria L. Lopez'); await pg.click('#profileForm button[type=submit]');
await pg.click('#tabbtn-bot');
ck('Profile change flows into chatbot preview', (await pg.textContent('#botPreview')).includes('Maria L. Lopez') && (await pg.textContent('#botPreview')).includes('(305) 555-9999'));
await pg.click('#tabbtn-profile'); await pg.check('#mfa'); await pg.click('#logout');
await pg.click('#signin'); ck('2-step verification asks for code', await pg.isVisible('#codeWrap'));
await pg.fill('#code','12'); await pg.click('#signin'); ck('Bad code rejected', await pg.isVisible('#loginView'));
await pg.fill('#code','123456'); await pg.click('#signin'); ck('Valid 6-digit code signs in', await pg.isVisible('#appView'));
await pg.screenshot({path:'/home/user/aca-lead-bot/test-screenshots/07-dashboard-profile.png',fullPage:true});
await pg.click('#logout');
// inactive agent
await pg.fill('#email','ana.rivera@example.com'); await pg.click('#signin');
ck('Inactive agent (Ana) blocked from signing in', (await pg.textContent('#loginErr')).includes('not active'));
await pg.fill('#email','nobody@example.com'); await pg.click('#signin');
ck('Unknown email blocked', (await pg.textContent('#loginErr')).includes('No agent account'));
// admin
await pg.click('#signinAdmin');
ck('Agent tabs hidden for admin view', !(await pg.isVisible('#tab-profile')) && !(await pg.isVisible('#tab-bot')));
ck('Admin sees agents table with 3 agents', (await pg.$$eval('#agentTable tr[data-id]',r=>r.length))===3);
ck('Admin flags missing license (Ana)', (await pg.textContent('#agentTable')).includes('Missing'));
await pg.click('#agentTable tr:has-text("Ana Rivera") .toggle');
ck('Cannot activate agent without license', (await pg.locator('.toast').last().textContent()).includes('license') && (await pg.textContent('#agentTable tr:has-text("Ana Rivera")')).includes('Inactive'));
await pg.click('#agentTable tr:has-text("James Carter") .toggle');
ck('Admin deactivates James', (await pg.textContent('#agentTable tr:has-text("James Carter")')).includes('Inactive'));
await pg.fill('#aName','Luis Gómez'); await pg.fill('#aEmail','luis@example.com'); await pg.fill('#aPhone','5615550100'); await pg.fill('#aLicense','FL-C111222');
await pg.click('#addAgent button[type=submit]');
ck('Admin adds new agent (starts inactive)', (await pg.$$eval('#agentTable tr[data-id]',r=>r.length))===4 && (await pg.textContent('#agentTable tr:has-text("Luis")')).includes('Inactive'));
await pg.fill('#aName','Dup'); await pg.fill('#aEmail','luis@example.com'); await pg.fill('#aPhone','5615550101'); await pg.click('#addAgent button[type=submit]');
ck('Duplicate email rejected', (await pg.textContent('#addMsg')).includes('already exists'));
await pg.click('#tabbtn-leads'); ck('Admin "All leads" shows every agent\'s leads (14)', (await pg.$$eval('#leadTable tr[data-id]',r=>r.length))===14);
await pg.click('#tabbtn-admin');
await pg.screenshot({path:'/home/user/aca-lead-bot/test-screenshots/08-dashboard-admin.png',fullPage:true});
// mobile + dark
for (const scheme of ['light','dark']){ const m=await b.newContext({...devices['iPhone 13'],colorScheme:scheme}); const mp=await m.newPage();
  await mp.goto(U); await mp.click('#signin');
  ck(`Phone ${scheme}: no horizontal page scroll`, !(await mp.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
  await mp.screenshot({path:`/home/user/aca-lead-bot/test-screenshots/09-dashboard-mobile-${scheme}.png`}); await m.close(); }
ck('No JavaScript errors', errs.length===0, errs.join('|'));
console.log(`\nRESULT: ${p} passed, ${f} failed`); await b.close();
})();
