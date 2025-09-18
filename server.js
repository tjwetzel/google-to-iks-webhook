const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json({ type: "*/*" }));
app.get("/", (_, res) => res.status(200).send("OK"));

// ---- ENV
const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY || "";
const IKS_TOKEN = process.env.IKS_TOKEN || "";
const LOCATION_QUESTION_COL_ID = "your_preferred_option"; // << map THIS Google column to IKS locations_select
const SOURCE_VALUE = (process.env.SOURCE_VALUE || "Google Ads - Tanner").trim();

const IKS_BASE = "https://api.intellikidsystems.com/api/v2";

// live config (so we use the exact allowed location IDs/sources for YOUR tenant)
let LIVE_LOCATIONS = [];   // [{id, name}]
let LIVE_SOURCES = [];     // ["Google Ads - Tanner", ...]
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
const nameParts = (full="") => {
  const p = full.trim().split(/\s+/); return { first: p[0] || "Lead", last: p.slice(1).join(" ") || "From Google" };
};
function chooseLocationIdByText(t="") {
  const s = (t||"").toLowerCase();
  let best = null, score = -1;
  const scoreFor = n => {
    const a = n.toLowerCase();
    let sc = 0;
    if (s.includes("moon")      && a.includes("moon")) sc+=2;
    if (s.includes("valley")    && a.includes("valley")) sc+=2;
    if (s.includes("midtown")   && a.includes("midtown")) sc+=3;
    if (s.includes("ahwatukee") && a.includes("ahwatukee")) sc+=3;
    if (s.includes("mesa")      && a.includes("mesa")) sc+=3;
    if (s.includes("scottsdale")&& a.includes("scottsdale")) sc+=3;
    if (s.includes("phoenix")   && a.includes("phoenix")) sc+=2;
    return sc;
  };
  for (const loc of LIVE_LOCATIONS) {
    const sc = scoreFor(loc.name || "");
    if (sc > score) { score = sc; best = loc; }
  }
  return best ? String(best.id) : null;
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
    const { first, last } = nameParts(full);
    const email = c.EMAIL || "";
    const phone = c.PHONE_NUMBER || "";
    const city  = c.CITY || "";
    const campaignName = req.body.campaign_name || "";

    // ---- YOUR MAPPING: Google answer -> IKS locations_select
    const locationAnswer = c[LOCATION_QUESTION_COL_ID] || ""; // e.g., "Moon Valley"
    const locations_select_value = locationAnswer;             // send this directly to IKS

    // Resolve a valid IKS location_id by matching the answer text to the LIVE config
    let locationId =
      chooseLocationIdByText(locationAnswer) ||
      chooseLocationIdByText(campaignName)  ||
      chooseLocationIdByText(city);

    if (!locationId && LIVE_LOCATIONS.length) locationId = String(LIVE_LOCATIONS[0].id);

    // Valid source
    const source = LIVE_SOURCES.includes(SOURCE_VALUE) ? SOURCE_VALUE : (LIVE_SOURCES[0] || "Google");

    // Minimal, safe core fields (send BOTH keys to appease picky tenants)
    const lead = {
      first_name: first,
      last_name:  last,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      source,
      location_id: Number(locationId),
      location:    Number(locationId)
    };

    // Custom fields – write the answer directly into IKS ‘locations_select’
    const customFields = {
      locations_select: locations_select_value || "",  // << direct mapping requested
      // If you also want to mirror into checkboxes, uncomment next line:
      // location_checkboxes: locations_select_value || ""
    };

    // Send via simplified form (most forgiving)
    const qs = new URLSearchParams();
    for (const [k,v] of Object.entries(lead)) qs.append(k, String(v));
    for (const [k,v] of Object.entries(customFields)) if (v) qs.append(k, String(v));

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

