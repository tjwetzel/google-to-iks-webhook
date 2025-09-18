const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json({ type: "*/*" }));
app.get("/", (_, res) => res.status(200).send("OK"));

// ---- ENV
const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY || "";
const IKS_TOKEN = process.env.IKS_TOKEN || "";
const LOCATION_QUESTION_COL_ID = "your_preferred_option"; // keep this exact
const SOURCE_VALUE = (process.env.SOURCE_VALUE || "Google Ads - Tanner").trim();

const IKS_BASE = "https://api.intellikidsystems.com/api/v2";

// ===== live config (so we use YOUR tenant’s real IDs)
let LIVE_LOCATIONS = [];
let LIVE_SOURCES = [];
async function loadConfig() {
  const r = await axios.get(`${IKS_BASE}/lead/config`, {
    headers: { Authorization: `Bearer ${IKS_TOKEN}` }, timeout: 15000
  });
  const d = r.data || {};
  LIVE_LOCATIONS = Array.isArray(d.locations) ? d.locations : (d.data?.locations || []);
  LIVE_SOURCES   = Array.isArray(d.sources)   ? d.sources   : (d.data?.sources || []);
  console.log("IKS config loaded:", {
    locations: LIVE_LOCATIONS.map(x => `${x.id}:${x.name}`).slice(0, 20),
    sources: LIVE_SOURCES
  });
}
async function ensureConfig() { if (!LIVE_LOCATIONS.length) await loadConfig(); }

// helpers
const cols = (a=[]) => a.reduce((o,c)=> (o[c.column_id]=c.string_value, o), {});
const splitName = (full="") => {
  const p = full.trim().split(/\s+/); return { first: p[0] || "Lead", last: p.slice(1).join(" ") || "From Google" };
};
function chooseLocationIdByText(t="") {
  const s = (t||"").toLowerCase();
  if (!s) return null;
  const scoreFor = n => {
    const a = (n||"").toLowerCase();
    let sc = 0;
    if (s.includes("32nd")) sc += a.includes("32nd") ? 10 : 0;
    if (s.includes("moon")) sc += a.includes("moon") ? 5 : 0;
    if (s.includes("valley")) sc += a.includes("valley") ? 5 : 0;
    if (s.includes("midtown")) sc += a.includes("midtown") ? 6 : 0;
    if (s.includes("ahwatukee")) sc += a.includes("ahwatukee") ? 6 : 0;
    if (s.includes("mesa")) sc += a.includes("mesa") ? 6 : 0;
    if (s.includes("scottsdale")) sc += a.includes("scottsdale") ? 6 : 0;
    if (s.includes("phoenix")) sc += a.includes("phoenix") ? 2 : 0;
    return sc;
  };
  let best=null, bestScore=-1;
  for (const loc of LIVE_LOCATIONS) {
    const sc = scoreFor(loc.name);
    if (sc > bestScore) { best = loc; bestScore = sc; }
  }
  return best ? String(best.id) : null; // <-- KEEP AS STRING
}

// debug
app.get("/debug-config", async (_req,res)=>{ try{ await ensureConfig(); res.json({locations:LIVE_LOCATIONS,sources:LIVE_SOURCES}); }catch(e){ res.status(500).json({error:e.message,detail:e?.response?.data}); }});
app.get("/", (_req,res)=>res.status(200).send("OK – webhook up"));

app.post("/google-leads", async (req, res) => {
  try {
    if (req.body.google_key !== GOOGLE_LEAD_KEY)
      return res.status(403).json({ message: "Invalid google_key" });

    await ensureConfig();

    const c = cols(req.body.user_column_data || []);
    const full = c.FULL_NAME || "";
    const { first, last } = splitName(full);
    const email = c.EMAIL || "";
    const phone = c.PHONE_NUMBER || "";

    // Google answer (your preferred option)
    const answer = c[LOCATION_QUESTION_COL_ID] || "";
    // Resolve to a valid IKS location ID (STRING!)
    let locationId = chooseLocationIdByText(answer);
    if (!locationId && LIVE_LOCATIONS.length) locationId = String(LIVE_LOCATIONS[0].id);

    // Source must be allowed; fall back to first
    const source = LIVE_SOURCES.includes(SOURCE_VALUE) ? SOURCE_VALUE : (LIVE_SOURCES[0] || "Google");

    // MINIMAL, safe payload — SEND IDS AS STRINGS (no Number())
    const lead = {
      first_name: first,
      last_name:  last,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      source,
      location_id: locationId,  // <-- STRING
      location:    locationId,  // <-- STRING (for picky tenants)
      locations_select: answer  // store the friendly label too
    };

    const qs = new URLSearchParams();
    for (const [k,v] of Object.entries(lead)) if (v !== undefined && v !== null) qs.append(k, String(v));

    console.log("Posting to IKS:", qs.toString());

    await axios.post(`${IKS_BASE}/lead/simplified`, qs.toString(), {
      headers: { Authorization: `Bearer ${IKS_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });

    console.log("IKS OK");
    return res.status(200).json({});
  } catch (e) {
    console.error("IKS error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(502).json({ message: "Upstream error" });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Webhook listening"));
