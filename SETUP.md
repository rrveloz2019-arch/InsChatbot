# ACA Lead Bot (Florida) — Setup Guide

## 1. Brand the bot for each agent (2 minutes)
Open `index.html` and edit the `CONFIG` block at the top of the script:
- `agencyName`, `agentName`, `licenseNo` (Florida license #), `agentPhone`
- `bookingUrl` (Calendly or similar; leave `""` to hide)
- `sheetEndpoint` (from step 2; leave `""` to save leads only in the browser)

## 2. Connect a private Google Sheet (about 10 minutes)
1. The agent signs in to **their own** Google account (turn on 2-Step Verification).
2. Create a new blank Google Sheet named e.g. "ACA Leads 2027". **Do not share it.**
3. In the Sheet: **Extensions → Apps Script**. Delete the sample code, paste in `google-sheet/Code.gs`, and save.
4. Optional: put the agent's email in `NOTIFY_EMAIL` for an instant new-lead alert.
5. **Deploy → New deployment → Type: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (the website must be able to send leads; the Sheet itself stays private)
6. Approve the permissions, then copy the **Web app URL** (ends in `/exec`).
7. Paste that URL into `sheetEndpoint` in `index.html`.
8. Test: complete one chat. A new row should appear in the `Leads` tab.

## 3. How secure is this?
**What is protected:**
- The Sheet is private. Only the agent's Google account can open it.
- Leads are sent over HTTPS (encrypted in transit).
- The script rejects leads without consent, with a bad phone number, or with a non-Florida ZIP code. It drops duplicates within 24 hours and blocks spreadsheet-formula injection.
- A hidden "honeypot" field filters out simple spam bots.
- The bot does **not** ask for SSNs, medical conditions or medications.

**Limits to be honest about:**
- Anyone who finds the web-app URL could send fake rows. Validation and the honeypot reduce this but don't stop it completely. For high volume, add reCAPTCHA or move to a CRM.
- The Google account is the security perimeter. Use 2-Step Verification and never share the Sheet publicly.
- Google Sheets is fine for contact leads. It is **not** the right place for medical information.

## 4. Before going live (required)
- [ ] An attorney reviews the consent text (federal TCPA + Florida Telephone Solicitation Act, Fla. Stat. § 501.059).
- [ ] The agent is licensed in Florida and registered with the Marketplace (CMS) for plan year 2027.
- [ ] Confirm the deadline (Dec 15, 2026 for HealthCare.gov) and the subsidy rules on HealthCare.gov.
- [ ] Host `index.html` on HTTPS (Netlify, GitHub Pages, or the agent's website).
- [ ] Put a privacy policy link on the page.
