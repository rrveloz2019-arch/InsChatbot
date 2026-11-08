/**
 * ACA Lead Bot -> private Google Sheet receiver (Google Apps Script)
 * Paste into Extensions > Apps Script of the agent's PRIVATE Google Sheet.
 * Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
 * The sheet itself stays private; only this script can write to it.
 */
const SHEET_NAME = 'Leads';
const NOTIFY_EMAIL = '';          // optional: agent email for an instant "new lead" alert
const COLS = ['createdAt','group','firstName','phone','bestTime','zip','household','income',
  'fplPct','coverage','priority','lang','consent','consentAt','consentText','pageUrl','userAgent','id'];
const ALLOWED_GROUPS = ['G1','G2','G3','G4','GAP','REVIEW'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > 8000) return out_('too_large');
    const d = JSON.parse(raw);

    // ---- validation: reject anything that is not a real, consented lead ----
    if (d.consent !== true || !d.consentText) return out_('no_consent');
    if (!/^\d{10}$/.test(String(d.phone))) return out_('bad_phone');
    if (!/^3[234]\d{3}$/.test(String(d.zip))) return out_('bad_zip');
    if (ALLOWED_GROUPS.indexOf(d.group) < 0) return out_('bad_group');

    const sh = getSheet_();
    // ---- de-duplicate: same phone in the last 24h is ignored ----
    const last = sh.getLastRow();
    if (last > 1) {
      const start = Math.max(2, last - 200);
      const rows = sh.getRange(start, 1, last - start + 1, 4).getValues();
      const dayAgo = Date.now() - 24 * 3600 * 1000;
      if (rows.some(r => String(r[3]) === String(d.phone) && new Date(r[0]).getTime() > dayAgo)) return out_('duplicate');
    }

    // prefix with ' so values starting with = + - @ are never treated as formulas
    const row = COLS.map(c => {
      const v = d[c] === undefined ? '' : String(d[c]).slice(0, 1000);
      return /^[=+\-@]/.test(v) ? "'" + v : v;
    });
    sh.appendRow(row);

    if (NOTIFY_EMAIL) {
      MailApp.sendEmail(NOTIFY_EMAIL, 'New ACA lead (' + d.group + ')',
        d.firstName + ' – ' + d.phone + ' – best time: ' + d.bestTime + ' – ZIP ' + d.zip);
    }
    return out_('ok');
  } catch (err) {
    return out_('error');
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); }
  if (sh.getLastRow() === 0) { sh.appendRow(COLS); sh.setFrozenRows(1); }
  return sh;
}

function out_(status) {
  return ContentService.createTextOutput(JSON.stringify({ status: status }))
    .setMimeType(ContentService.MimeType.JSON);
}
