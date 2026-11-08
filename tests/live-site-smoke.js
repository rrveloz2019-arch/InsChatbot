const { chromium, devices } = require('playwright');
const B='https://inschatbot.netlify.app'; let p=0,f=0; const ck=(n,c,x='')=>{c?p++:f++;console.log((c?'PASS ':'FAIL ')+n+(x?'  '+x:''))};
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1200,height:900}});
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r=>r.abort());
  const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto(B+'/'); await pg.waitForURL(/portal\.html/,{timeout:15000});
  ck('Home address opens the Agent Portal', pg.url().endsWith('/portal.html'));
  await pg.waitForSelector('#authView:not([hidden])');
  ck('Sign-in form shows', await pg.isVisible('#email') && await pg.isVisible('#password'));
  await pg.fill('#email','nobody@example.com'); await pg.fill('#password','wrong-password-123'); await pg.click('#authBtn');
  await pg.waitForFunction(()=>document.getElementById('authMsg').textContent.length>0,null,{timeout:15000});
  ck('Live login talks to Supabase (wrong password rejected)', (await pg.textContent('#authMsg')).includes('incorrect'), await pg.textContent('#authMsg'));
  await pg.click('#modeUp'); ck('"Create account" form shows name field', await pg.isVisible('#fullName'));
  await pg.fill('#fullName','X'); await pg.fill('#email','x@example.com'); await pg.fill('#password','short'); await pg.click('#authBtn');
  ck('Sign-up requires 10+ character password', (await pg.textContent('#authMsg')).includes('10 characters'));
  await pg.screenshot({path:'/home/user/aca-lead-bot/test-screenshots/17-LIVE-portal-signin.png'});
  await pg.goto(B+'/chat.html?agent=no-such-agent'); await pg.waitForSelector('#unavailable',{timeout:15000});
  ck('Chatbot with unknown link says "not active" (EN + ES)', (await pg.textContent('#unavailable')).includes('not active') && (await pg.textContent('#unavailable')).includes('no está activo'));
  await pg.goto(B+'/chat.html'); await pg.waitForSelector('#unavailable',{timeout:15000});
  ck('Chatbot without agent link says "not active"', true);
  for (const s of ['light','dark']) { const m=await b.newContext({...devices['iPhone 13'],colorScheme:s}); await m.route(/fonts\./,r=>r.abort());
    const mp=await m.newPage(); await mp.goto(B+'/portal.html'); await mp.waitForSelector('#authView:not([hidden])');
    ck(`Phone ${s}: portal fits the screen`, !(await mp.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
    if(s==='light') await mp.screenshot({path:'/home/user/aca-lead-bot/test-screenshots/18-LIVE-portal-phone.png'}); await m.close(); }
  ck('No JavaScript errors on the live site', errs.length===0, errs.join(' | '));
  console.log(`\nRESULT: ${p} passed, ${f} failed`); await b.close(); process.exit(f?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(2)});
