const fs=require('fs'), vm=require('vm');
const rows=[]; const sheet={getLastRow:()=>rows.length,appendRow:r=>rows.push(r),setFrozenRows(){},getRange:(s,c,n,w)=>({getValues:()=>rows.slice(s-1,s-1+n).map(r=>r.slice(0,w))})};
const ctx={LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet,insertSheet:()=>sheet})},
 MailApp:{sendEmail(){}},ContentService:{MimeType:{JSON:1},createTextOutput:s=>({s,setMimeType(){return this}})},JSON,Date,String,Math};
vm.createContext(ctx); vm.runInContext(fs.readFileSync('/home/user/aca-lead-bot/google-sheet/Code.gs','utf8'),ctx);
const post=d=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(d)}}).s).status;
const good={createdAt:new Date().toISOString(),group:'G1',firstName:'Ana',phone:'3055550123',zip:'33101',consent:true,consentText:'I agree...'};
let p=0,f=0;const ck=(n,c)=>{c?p++:f++;console.log((c?'PASS ':'FAIL ')+n)};
ck('valid lead saved', post(good)==='ok' && rows.length===2);
ck('header row created', rows[0][0]==='createdAt');
ck('no consent rejected', post({...good,phone:'3055550000',consent:false})==='no_consent');
ck('bad phone rejected', post({...good,phone:'123'})==='bad_phone');
ck('non-FL zip rejected', post({...good,phone:'3055550001',zip:'90210'})==='bad_zip');
ck('fake group rejected', post({...good,phone:'3055550002',group:'HACK'})==='bad_group');
ck('duplicate phone within 24h ignored', post(good)==='duplicate');
post({...good,phone:'3055550003',firstName:'=HYPERLINK("http://evil")'});
ck('formula injection neutralized', rows[rows.length-1][2].startsWith("'="));
ck('oversized payload rejected', JSON.parse(ctx.doPost({postData:{contents:'x'.repeat(9000)}}).s).status==='too_large');
console.log(`\nRESULT: ${p} passed, ${f} failed`);
