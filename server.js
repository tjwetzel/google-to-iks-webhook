const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ type: "*/*" }));
app.get("/", (_, res) => res.status(200).send("OK"));

// ENV
const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY || "";
const IKS_TOKEN = process.env.IKS_TOKEN || "";
const LOCATION_QUESTION_COL_ID = process.env.LOCATION_QUESTION_COL_ID || ""; // e.g., "your_preferred_option"

// IKS
const IKS_BASE = "https://api.intellikidsystems.com/api/v2";
const LOCATIONS = {
  moon_valley: "1031842527598690591",
  midtown:     "869433737132249695",
  ahwatukee:   "768926818228114422",
  mesa:        "768926817510891380",
  scottsdale:  "768926815564732288",
  phoenix:     "768926813861845343"
};

// helpers
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
function pickLocationId(answer) {
  const key = textToKey(answer) || "phoenix";
  return Number(LOCATIONS[key]);
}

app.post("/google-leads", async (req, res) => {
  try {
    if (req.body.google_key !== GOOGLE_LEAD_KEY) return res.status(403).json({ message: "Invalid google_key" });

    const col = columnsToObj(req.body.user_column_data || []);
    const full = col.FULL_NAME || "";
    const first = col.FIRST_NAME || full.split(" ")[0] || "Lead";
    const last  = col.LAST_NAME  || full.replace(/^(\S+)\s*/, "") || "From Google";
    const email = col.EMAIL || "";
    const phone = col.PHONE_NUMBER || "";
    const locationAnswer = LOCATION_QUESTION_COL_ID ? (col[LOCATION_QUESTION_COL_ID] || "") : "";

    const location_id = pickLocationId(locationAnswer);
    const source = "Google Ads - Tanner"; // EXACT value from your IKS list

    // ---- MINIMAL payload (only required/standard IKS fields) ----
    const lead = {
      first_name: first,
      last_name:  last,
      // at least one of phone/email; include both if present
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      location_id,
      source
    };

    // Try the simplified endpoint as form-data (least picky)
    const qs = new URLSearchParams();
    for (const [k,v] of Object.entries(lead)) qs.append(k, String(v));
    console.log("Posting minimal lead:", qs.toString());

    await axios.post(`${IKS_BASE}/lead/simplified`, qs.toString(), {
      headers: { Authorization: `Bearer ${IKS_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });

    console.log("IKS OK (minimal)");
    return res.status(200).json({});
  } catch (e) {
    console.error("IKS error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(502).json({ message: "Upstream error" });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Webhook listening"));
