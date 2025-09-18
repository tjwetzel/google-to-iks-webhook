const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ type: "*/*" }));
app.get("/", (_, res) => res.status(200).send("OK"));

// ===== ENV =====
const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY || "";
const IKS_TOKEN = process.env.IKS_TOKEN || "";
const LOCATION_QUESTION_COL_ID = process.env.LOCATION_QUESTION_COL_ID || ""; // "your_preferred_option"
let CAMPAIGN_MAP = {};
try { CAMPAIGN_MAP = JSON.parse(process.env.CAMPAIGN_MAP_JSON || "{}"); } catch { CAMPAIGN_MAP = {}; }

// env sanity
console.log("ENV:", {
  LOCATION_QUESTION_COL_ID,
  CAMPAIGN_MAP_KEYS: Object.keys(CAMPAIGN_MAP).length
});

// ===== IKS =====
const IKS_BASE = "https://api.intellikidsystems.com/api/v2";
const LOCATIONS = {
  moon_valley: "1031842527598690591",
  midtown:     "869433737132249695",
  ahwatukee:   "768926818228114422",
  mesa:        "768926817510891380",
  scottsdale:  "768926815564732288",
  phoenix:     "768926813861845343"
};

// ===== helpers =====
function columnsToObj(arr = []) { const o = {}; for (const c of arr) o[c.column_id] = c.string_value; return o; }
function textToKey(t = "") {
  const a = t.toLowerCase();
  if (a.includes("moon")) return "moon_valley";
  if (a.includes("midtown")) return "midtown";
  if (a.includes("ahwatukee")) return "ahwatukee";
  if (a.includes("mesa")) return "mesa";
  if (a.includes("scottsdale")) return "scottsdale";
  if (a.includes("phoenix")) return "phoenix";
  return null;
}
function pickLocationId({ locationAnswer, campaignName, campaignId, cityText }) {
  const k1 = textToKey(locationAnswer); if (k1) return LOCATIONS[k1];
  const k2 = textToKey(campaignName);   if (k2) return LOCATIONS[k2];
  const mapped = CAMPAIGN_MAP[String(campaignId)]; if (mapped && LOCATIONS[mapped]) return LOCATIONS[mapped];
  const k3 = textToKey(cityText);       if (k3) return LOCATIONS[k3];
  return LOCATIONS.phoenix;
}

// ===== IKS send with retries (handles weird schemas) =====
async function sendToIKS(lead) {
  // Try 1: JSON body → /lead
  try {
    const body = { lead: lead };
    console.log("Try1 /lead JSON:", JSON.stringify(body));
    await axios.post(`${IKS_BASE}/lead`, body, {
      headers: { Authorization: `Bearer ${IKS_TOKEN}`, "Content-Type": "application/json" },
      timeout: 15000
    });
    console.log("Try1 OK");
    return;
  } catch (e1) {
    console.error("Try1 FAIL:", e1?.response?.status, e1?.response?.data || e1.message);
  }

  // Try 2: form-data → /lead/simplified with location_id
  try {
    const qs = new URLSearchParams();
    for (const [k,v] of Object.entries(lead)) if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
    console.log("Try2 /lead/simplified form (location_id):", qs.toString());
    await axios.post(`${IKS_BASE}/lead/simplified`, qs.toString(), {
      headers: { Authorization: `Bearer ${IKS_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });
    console.log("Try2 OK");
    return;
  } catch (e2) {
    console.error("Try2 FAIL:", e2?.response?.status, e2?.response?.data || e2.message);
  }

  // Try 3: form-data but use "location" (some installs use this key)
  try {
    const qs = new URLSearchParams();
    for (const [k,v] of Object.entries(lead)) {
      if (k === "location_id") qs.append("location", String(v));
      else if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
    }
    console.log("Try3 /lead/simplified form (location):", qs.toString());
    await axios.post(`${IKS_BASE}/lead/simplified`, qs.toString(), {
      headers: { Authorization: `Bearer ${IKS_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });
    console.log("Try3 OK");
    return;
  } catch (e3) {
    console.error("Try3 FAIL:", e3?.response?.status, e3?.response?.data || e3.message);
    throw e3;
  }
}

// ===== webhook =====
app.post("/google-leads", async (req, res) => {
  try {
    if (req.body.google_key !== GOOGLE_LEAD_KEY) return res.status(403).json({ message: "Invalid google_key" });

    const formId      = req.body.form_id;
    const campaignId  = req.body.campaign_id;
    const campaignName= req.body.campaign_name || "";
    const adGroupId   = req.body.adgroup_id;

    const col = columnsToObj(req.body.user_column_data || []);
    console.log("Cols:", Object.keys(col));

    const fullName   = col.FULL_NAME || "";
    const first      = col.FIRST_NAME || fullName.split(" ")[0] || "";
    const last       = col.LAST_NAME  || fullName.replace(/^(\S+)\s*/, "") || "";
    const email      = col.EMAIL || "";
    const phone      = col.PHONE_NUMBER || "";
    const city       = col.CITY || "";
    const postalCode = col.POSTAL_CODE || "";
    const jobTitle   = col.JOB_TITLE || "";
    const gclid      = req.body.gcl_id || "";

    const locationAnswer = LOCATION_QUESTION_COL_ID ? (col[LOCATION_QUESTION_COL_ID] || "") : "";
    console.log("LOC_Q_COL:", LOCATION_QUESTION_COL_ID, "Answer:", locationAnswer);

    const locationIdStr = pickLocationId({ locationAnswer, campaignName, campaignId, cityText: city });
    const locationIdNum = Number(locationIdStr);
    console.log("Chosen location_id:", locationIdNum);

    const lead = {
      first_name: first || undefined,
      last_name:  last  || undefined,
      email:      email || undefined,
      phone:      phone || undefined,
      city:       city  || undefined,
      postal_code: postalCode || undefined,
      job_title:  jobTitle || undefined,
      source:     "Google Ads Lead Form",
      location_id: locationIdNum,
      gclid:      gclid || undefined,
      notes: `GA lead_id:${req.body.lead_id||"n/a"}; form_id:${formId}; campaign_id:${campaignId}; adgroup_id:${adGroupId}; campaign_name:${campaignName}`
    };

    await sendToIKS(lead);

    return res.status(200).json({});
  } catch (e) {
    console.error("FINAL FAIL:", e?.response?.status, e?.response?.data || e.message);
    return res.status(502).json({ message: "Upstream error" });
  }
});

// quick debug: view IKS field config, if needed
app.get("/debug-config", async (_, res) => {
  try {
    const r = await axios.get(`${IKS_BASE}/lead/config`, {
      headers: { Authorization: `Bearer ${IKS_TOKEN}` }
    });
    res.json(r.data);
  } catch (e) { res.status(500).send(e.message); }
});

app.listen(process.env.PORT || 3000, () => console.log("Webhook listening"));
