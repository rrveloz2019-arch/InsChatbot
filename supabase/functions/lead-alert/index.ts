// lead-alert: emails a new lead to the agent's profile email (only if the agent turned alerts on).
// Called only by the database trigger (checked with a secret stored in the database Vault).
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const GROUPS: Record<string, string> = {
  G1: "Group 1 – Possible $0 premium",
  G2: "Group 2 – Low deductible (Silver with cost-sharing reductions)",
  G3: "Group 3 – Check-ups / routine care",
  G4: "Group 4 – Pays some premium and deductible",
  GAP: "Coverage gap – needs your review",
  REVIEW: "Already has coverage – needs your review",
};
const TIMES: Record<string, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
const PORTAL = "https://inschatbot.netlify.app/portal.html";
const FROM = "AgentSys Lead Bot <alerts@agentsys-dev.com>";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const phone = (p: string) => (p && p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: allowed } = await sb.rpc("check_lead_alert_secret", { s: req.headers.get("x-lead-alert-secret") ?? "" });
  if (allowed !== true) return json({ status: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  if (typeof body.lead_id !== "string") return json({ status: "bad_request" }, 400);

  const { data: lead, error } = await sb.from("leads")
    .select("id, created_at, first_name, phone, best_time, zip, household, fpl_pct, coverage, priority, grp, lang, alert_status, agents(full_name, email, alerts_email)")
    .eq("id", body.lead_id).single();
  if (error || !lead) return json({ status: "lead_not_found" }, 404);
  if (lead.alert_status === "sent") return json({ status: "already_sent" });

  const agent = lead.agents as { full_name: string; email: string; alerts_email: boolean } | null;
  const mark = (status: string) => sb.from("leads").update({ alert_status: status, alert_sent_at: status === "sent" ? new Date().toISOString() : null }).eq("id", lead.id);
  if (!agent || !agent.alerts_email) { await mark("skipped_alerts_off"); return json({ status: "skipped_alerts_off" }); }

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { await mark("error_no_key"); return json({ status: "error_no_key" }, 500); }

  const group = GROUPS[lead.grp] ?? lead.grp;
  const when = TIMES[lead.best_time ?? ""] ?? "Any time";
  const subject = `New lead: ${lead.first_name} – ${group.split(" – ")[0]} – call in the ${when.toLowerCase()}`;
  const rows: [string, string][] = [
    ["Name", lead.first_name], ["Phone", phone(lead.phone)], ["Best time to call", when], ["Group", group],
    ["ZIP code", lead.zip], ["Household size", String(lead.household)], ["Income vs. poverty level", `${lead.fpl_pct}%`],
    ["Current coverage", lead.coverage], ["Chatted in", lead.lang === "es" ? "Spanish" : "English"],
    ["Received", new Date(lead.created_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " (Eastern)"],
  ];
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
    <h2 style="color:#0b6e4f;margin:0 0 6px">New lead from your chatbot</h2>
    <p style="margin:0 0 14px">Hi ${esc(agent.full_name)}, a new person asked for help with 2027 health coverage. They agreed to be contacted by phone and text.</p>
    <table cellpadding="6" style="border-collapse:collapse;width:100%">${rows.map(([k, v]) => `<tr><td style="border-bottom:1px solid #e3e8e5;color:#56635d">${esc(k)}</td><td style="border-bottom:1px solid #e3e8e5"><b>${esc(v)}</b></td></tr>`).join("")}</table>
    <p style="margin:16px 0"><a href="${PORTAL}" style="background:#0b6e4f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open my leads</a></p>
    <p style="font-size:12px;color:#777">Group is an estimate from the chatbot answers. Confirm eligibility on HealthCare.gov before recommending a plan. You get these emails because new-lead alerts are on in your profile.</p></div>`;
  const text = `New lead from your chatbot\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nOpen your leads: ${PORTAL}`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [agent.email], subject, html, text }),
  });
  if (!r.ok) { let detail = ""; try { const e = await r.json(); detail = String(e.message ?? e.name ?? "").slice(0, 160); } catch { /* not json */ } await mark(`error_${r.status}: ${detail}`); console.error("resend error", r.status, detail); return json({ status: "error", code: r.status }, 502); }
  await mark("sent");
  return json({ status: "sent" });
});
