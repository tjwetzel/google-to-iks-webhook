const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ type: "*/*" }));
app.get("/", (_, res) => res.status(200).send("OK"));

// ---------- ENV ----------
const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY || "";
const IKS_TOKEN = process.env.IKS_TOKEN || "";
const LOCATION_QUESTION_COL_ID = process.env.LOCATION_QUESTION_COL_ID || ""; // should be "your_preferred_option"
let CAMPAIGN_MAP = {};
try { CAMPAIGN_MAP = JSON.parse(process.env.CAMPAIGN_MAP_JSON || "{}"); } catch { CAMPAIGN_MAP = {}; }

// Log what we loaded so you can verify in Render logs
console.log("ENV check:", {
  LOCATION_QUESTION_COL_ID,
  CAMPAIGN_MAP_KEYS: Object.keys(CAMPAIGN_MAP).length
});

// ---------- IKS ----------
const IKS_BASE = "https://api.intellikidsystems.com/api/v2";
const LOCATIONS = {
  moon_valley: "1031842527598690591",
  midtown:     "869433737132249695",
  ahwatukee:   "768926818228114422",
  mesa:        "768926817510891380",
  scottsdale:  "768926815564732288",
  phoenix:     "768926813861845343"
};

// ---------- helpers ----------
function columnsToObj(arr = []) { const o={}; for (const c of arr) o[c.column_id]=c.string_value; return o; }
function textToLocationKey(t="") {
  const a=t.toLowerCase();
  if (a.includes("moon")) return "moon_valley";
  if (a.includes("midtown")) return "midtown";
  if (a.includes("ahwatukee")) return "ahwatukee";
  if (a.includes("mesa")) return "mesa";
  if (a.includes("scottsdale")) return "scottsdale";
  if (a.includes("phoenix")) return "phoenix";
  return null;
}
function pickLocationId({locationAnswer,campaignName,campaignId,cityText}) {
  const byAnswer = textToLocationKey(locationAnswer); if (byAnswer) return LOCATIONS[byAnswer];
  const byName = textToLocationKey(campaignName);     if (byName)   return LOCATIONS[byName];
  const mappedKey = CAMPAIGN_MAP[String(campaignId)]; if (mappedKey && LOCATIONS[mappedKey]) return LOCATIONS[mappedKey];
  const byCity = textToLocationKey(cityText);         if (byCity)   return LOCATIONS[byCity];
  return LOCATIONS.phoenix;
}

// ---------- webhook ----------
app.post("/google-leads", async (req, res) => {
  try {
    if (req.body.google_key !== GOOGLE_LEAD_KEY) return res.status(403).json({ message: "Invalid google_key" });

    const formId      = req.body.form_id;
    const campaignId  = req.body.campaign_id;
    const campaignName= req.body.campaign_name || "";
    const adGroupId   = req.body.adgroup_id;

    const col = columnsToObj(req.body.user_column_data || []);
    console.log("Column IDs present:", Object.keys(col)); // see your_preferred_option here

    const fullName   = col.FULL_NAME || "";
    const first      = col.FIRST_NAME || fullName.split(" ")[0] || "";
    const last       = col.LAST_NAME  || fullName.replace(/^(\S+)\s*/, "") || "";
    const email      = col.EMAIL || "";
    const phone      = col.PHONE_NUMBER || "";
    const city       = col.CITY || "";
    const postalCode = col.POSTAL_CODE || "";
    const jobTitle   = col.JOB_TITLE || "";
    const gclid      = req.body.gcl_id || "";

    const locationAnswer =
      LOCATION_QUESTION_COL_ID ? (col[LOCATION_QUESTION_COL_ID] || "") : "";
    console.log("LOCATION_QUESTION_COL_ID:", LOCATION_QUESTION_COL_ID, "locationAnswer:", locationAnswer);

    const locationIdStr = pickLocationId({ locationAnswer, campaignName, campaignId, cityText: city });
    const locationIdNum = Number(locationIdStr);
    console.log("Routing to location_id:", locationIdNum);

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

    console.log("Payload to IKS:", JSON.stringify({ lead }));

    const qs = new URLSearchParams();
    for (const [k,v] of Object.entries(lead)) if (v!==undefined && v!==null && v!=="") qs.append(k, String(v));
    await axios.post(`${IKS_BASE}/lead/simplified`, qs.toString(), {
      headers: { Authorization: `Bearer ${IKS_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });

    return res.status(200).json({});
  } catch (e) {
    console.error("IKS forward failed:", e?.response?.status, e?.response?.data || e.message);
    return res.status(502).json({ message: "Upstream error" });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Webhook listening"));
