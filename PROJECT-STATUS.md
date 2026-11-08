# InsChatbot – Project Status (Nov 8, 2026)

Florida ACA open-enrollment lead chatbot, sold to licensed insurance agents.

## 1. The business idea
- Product: a bilingual (English/Spanish) chatbot that licensed agents put in their ads, social media and flyers.
- It collects leads for 2027 ACA (Obamacare) coverage in Florida and sorts them into 4 groups.
- You (info@agentsys-dev.com) are the admin; agents sign up, you approve them.
- Deadline: Dec 15, 2026 is the last day for Jan 1 coverage on HealthCare.gov.

## 2. The 4 lead groups (Florida rules)
| Group | Who | Plan type |
|---|---|---|
| 1 – $0 premium | Income 100–150% of the poverty level, wants the lowest payment | Bronze (sometimes Silver) fully covered by the subsidy; usually a higher deductible |
| 2 – Low deductible | Income up to 250%, wants a low deductible | Silver with cost-sharing reductions |
| 3 – Check-ups | Wants routine care | Every plan covers preventive care at $0 |
| 4 – Pays some | Income over 250% | Bronze/Silver/Gold; over 400% means no subsidy in 2027 |
| Coverage gap | Under 100% (Florida did not expand Medicaid) | Agent reviews; children may qualify for KidCare |
| Needs review | Already has job coverage, Medicare or Medicaid | Agent reviews |

Poverty level used: 2026 HHS guidelines ($15,960 for 1 person + $5,680 per extra person), which apply to 2027 coverage.

## 3. What is built and tested
| Part | Status | Tests |
|---|---|---|
| Chatbot (6 questions, EN/ES, consent checkbox, groups 1–4) | Done | 20/20 Playwright |
| Google Sheet connector (optional) | Done | 9/9 |
| Agent dashboard prototype (leads, filters, statuses, link, QR with agent photo, profile, 2-step login) | Done (demo data) | 33/33 Playwright, QR scan verified |
| Admin dashboard prototype (add/approve/deactivate agents, license check, all leads, totals) | Done (demo data) | included above |
| Supabase database (agents, leads, photo storage) | Live, empty | 25/25 security tests in the real database |
| Security rules (agents see only their own leads; public can't read anything) | Live | 6/6 live API attack tests blocked |
| Admin = info@agentsys-dev.com, only after the email is confirmed | Live | 3/3 |

## 4. Links
- GitHub: https://github.com/rrveloz2019-arch/InsChatbot (backup branches: v1, v2, v3)
- Chatbot demo: https://claude.ai/artifact/PCpaYhCRn81qs4V9YeYFF6 (private; share it from the page)
- Dashboard demo: https://claude.ai/artifact/TAK2iR7zcm9kuFwG9t6K1C (private)
- Supabase project: vmauuwxeojbwlwcpvtxb (free plan)

## 5. Version history
- v1: chatbot, Google Sheet connector, dashboard prototype with photo QR, tests
- v2: Supabase database setup scripts (supabase/migrations 001–004)
- v3: this status document

## 6. Still to do (Option B)
1. Connect the real dashboard and chatbot to Supabase: real sign-up/login, photo upload, live leads. Then run an end-to-end Playwright test.
2. Hosting: create a free Netlify account so agents get links like yoursite.netlify.app/?agent=name.
3. New-lead email alerts (Resend, free tier).
4. Later: billing for agents (Stripe).

## 7. Before any agent goes live (required)
- An attorney reviews the consent text (federal TCPA + Florida Telephone Solicitation Act, Fla. Stat. 501.059).
- Every agent is licensed in Florida and registered with CMS for plan year 2027.
- Re-check the Dec 15 deadline and the subsidy rules on HealthCare.gov.
- Add a privacy policy page.
- Not legal or tax advice.
