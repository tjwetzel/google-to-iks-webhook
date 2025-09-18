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

// ===== IKS constants =====
const IKS_BASE = "https://api.intellikidsystems.com/api/v2";

// Location IDs (IKS) and human labels (for your custom field)
const LOCATIONS = {
  moon_valley: { id: "1031842527598690591", label: "Whiz Kidz Moon Valley" },
  midtown:     { id: "869433737132249695",  label: "Whiz Kidz Midtown" },
  ahwatukee:   { id: "768926818228114422",  label: "Whiz Kidz Preschool Ahwatukee" },
  mesa:        { id: "768926817510891380",  label: "Whiz Kidz Mesa" },
  scottsdale:  { id: "768926815564732288",  label: "Whiz Kidz Scottsdale" },
  phoenix:     { id: "768926813861845343",  label: "Whiz Kidz Phoenix" }
};

// Your IKS custom field system names (from your screenshot)
const FIELD_LOC_SELECT = "locations_select";     // Select
const FIELD_LOC_CHECKS = "location_checkboxes";  // Checkboxes (we'll also fill)

// ===== helpers =====
function columnsToObj(arr = []) { const o={}; for (const c of arr) o[c.column_id]=c.string_value; return o; }
function textToKey(t="") {
  const a=t.toLowerCase();
  if (a.includes("moon")) return "moon_valley";
  if (a.includes("midtown")) return "midtown";
  if (a.includes("ahwatukee")) return "ahwatukee";
  if (a.includes("mesa")) return "mesa";
  if (a.includes("scottsdale")) return "scottsdale";
  if (a.includes("phoenix")) return "phoenix";
  return null;
}
function pickLoc({ locationAnswer, campaignName, campaignId, cityText }) {
  const k1 = textToKey(locationAnswer); if (k1) return LOCATIONS[k1];
  const k2 = textToKey(campaignName);   if (k2) return LOCATIONS[k2];
  const mapped = CAMPAIGN_MAP[String(campaignId)];
  if (mapped && LOCATIONS[mapped]) return LOCATIONS[mapped];
  const k3 = textToKey(cityText);       if (k3) return LOCATIONS[k3];
  return LOCATIONS.phoenix;
}

// Send to IKS (try JSON, then simplified form)
async function sendToIKS(lead, custom) {
  // Try 1: JSON /lead
  try {
    const body = { lead: { ...lead, custom_fields: custom } };
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

  // Try 2: form /lead/simplified  (flat key/values)
  try {
    const qs = new URLSearchParams();
    for (const [k,v] of Object.entries(lead)) if (v!==undefined && v!==null && v!=="") qs.append(k, String(v));
    // custom fields go as their system names for simplified
    for (const [k,v] of Object.entries(custom)) if (v) qs.append(k, String(v));
    console.log("Try2 /lead/simplified form:", qs.toString());
    await axios.post(`${IKS_BASE}/lead/simplified`, qs.toString(), {
      headers: { Authorization: `Bearer ${IKS_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });
    console.log("Try2 OK");
    return;
  } catch (e2) {
    console.error("Try2 FAIL:", e2?.response?.status, e2?.response?.data || e2.message);
  }

  throw new Error("All attempts to send to IKS failed");
}

// ===== webhook =====
app.post("/google-leads", async (req, res) => {
  try {
    if (req.body.google_key !== GOOGLE_LEAD_KEY) return res.status(403).json({ message: "Invalid google_key" });

    const campaignId  = req.body.campaign_id;
    const campaignName= req.body.campaign_name || "";

    const col = columnsToObj(req.body.user_column_data || []);
    console.log("Cols:", Object.keys(col));

    const fullName   = col.FULL_NAME || "";
    const first      = col.FIRST_NAME || fullName.split(" ")[0] || "";
    const last       = col.LAST_NAME  || fullName.replace(/^(\S+)\s*/, "") || "";
    const email      = col.EMAIL || "";
    const phone      = col.PHONE_NUMBER || "";
    const city       = col.CITY || "";
    const postalCode = col.POSTAL_CODE || "";

    const locationAnswer = LOCATION_QUESTION_COL_ID ? (col[LOCATION_QUESTION_COL_ID] || "") : "";
    console.log("Location answer:", LOCATION_QUESTION_COL_ID, "=>", locationAnswer);

    const loc = pickLoc({ locationAnswer, campaignName, campaignId, cityText: city });
    const locationIdNum = Number(loc.id);

    // base lead
    const lead = {
      first_name: first || undefined,
      last_name:  last  || undefined,
      email:      email || undefined,
      phone:      phone || undefined,
      city:       city  || undefined,
      postal_code: postalCode || undefined,
      source:     "Google Ads Lead Form",
      location_id: locationIdNum
    };

    // custom fields for your UI
    const custom = {
      [FIELD_LOC_SELECT]: loc.label,          // dropdown visible to staff
      [FIELD_LOC_CHECKS]: loc.label           // also mark the checkbox set
    };

    console.log("Routing to:", loc.label, "(", locationIdNum, ")");
    console.log("Custom fields:", custom);

    await sendToIKS(lead, custom);

    return res.status(200).json({});
  } catch (e) {
    console.error("FINAL FAIL:", e?.response?.status, e?.response?.data || e.message);
    return res.status(502).json({ message: "Upstream error" });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Webhook listening"));
