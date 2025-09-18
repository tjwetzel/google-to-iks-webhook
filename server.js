const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ type: "*/*" }));

// Optional health check so base URL shows OK
app.get("/", (_, res) => res.status(200).send("OK"));

// === YOUR SECRETS FROM RENDER ===
const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY;
const IKS_TOKEN = process.env.IKS_TOKEN;

// IKS base
const IKS_BASE = "https://api.intellikidsystems.com/api/v2";

// ---- 1) Your 6 location IDs (from IKS URLs) ----
const LOCATIONS = {
  moon_valley: "1031842527598690591",
  midtown:     "869433737132249695",
  ahwatukee:   "768926818228114422",
  mesa:        "768926817510891380",
  scottsdale:  "768926815564732288",
  phoenix:     "768926813861845343"
};

// ---- 2) Map Google Lead Form IDs -> IKS location_ids ----
// You'll fill these after you run Google’s “Send test data” and read `form_id` in logs.
const FORM_TO_LOCATION = {
  // e.g. 123456: LOCATIONS.scottsdale,
  // e.g. 234567: LOCATIONS.mesa,
};

// helper: convert Google’s array into { COLUMN_ID: "value" }
function columnsToObj(user_column_data = []) {
  const o = {};
  for (const c of user_column_data) o[c.column_id] = c.string_value;
  return o;
}

// choose location_id by priority:
// 1) exact form_id match (best: one form per campus)
// 2) try to guess from city text (fallback)
// 3) default to Phoenix to satisfy IKS required field
function pickLocationId({ formId, cityText }) {
  if (FORM_TO_LOCATION[formId]) return FORM_TO_LOCATION[formId];

  const a = (cityText || "").toLowerCase();
  if (a.includes("scottsdale")) return LOCATIONS.scottsdale;
  if (a.includes("mesa"))       return LOCATIONS.mesa;
  if (a.includes("ahwatukee"))  return LOCATIONS.ahwatukee; // sometimes city may be "Phoenix"
  if (a.includes("midtown"))    return LOCATIONS.midtown;   // unlikely from city field, but here anyway
  if (a.includes("moon"))       return LOCATIONS.moon_valley;
  if (a.includes("phoenix"))    return LOCATIONS.phoenix;

  return LOCATIONS.phoenix; // safe fallback so IKS accepts the lead
}

app.post("/google-leads", async (req, res) => {
  try {
    // 0) validate Google key
    if (req.body.google_key !== GOOGLE_LEAD_KEY) {
      return res.status(403).json({ message: "Invalid google_key" });
    }

    // 1) inspect payload
    const formId = req.body.form_id;
    console.log("Received form_id:", formId);

    const col = columnsToObj(req.body.user_column_data || []);

    // 2) pull fields
    const fullName   = col.FULL_NAME || "";
    const first      = col.FIRST_NAME || fullName.split(" ")[0] || "";
    const last       = col.LAST_NAME  || fullName.replace(/^(\S+)\s*/, "") || "";
    const email      = col.EMAIL || "";
    const phone      = col.PHONE_NUMBER || "";
    const city       = col.CITY || "";
    const postalCode = col.POSTAL_CODE || "";
    const jobTitle   = col.JOB_TITLE || "";

    // If you added custom questions, read them here:
    // const enrollSoon = col.CUSTOM_QUESTION_1 || "";
    // const program    = col["which_program_are_you_interested_in?"] || "";

    // 3) decide location
    const location_id = pickLocationId({ formId, cityText: city });
    console.log("Routing to location_id:", location_id);

    // 4) build IKS lead
    const iksLead = {
      first_name: first || undefined,
      last_name:  last || undefined,
      email:      email || undefined,
      phone:      phone || undefined,
      city:       city || undefined,
      postal_code: postalCode || undefined,
      job_title:  jobTitle || undefined,
      source:     "Google Ads Lead Form",
      location_id,
      notes: `GA lead_id: ${req.body.lead_id || "n/a"}; form_id: ${formId}`
      // If IKS has specific custom fields, add them here:
      // custom_fields: { enrollment_timing: enrollSoon, interested_program: program }
    };

    // 5) send to IKS
    await axios.post(`${IKS_BASE}/lead`, { lead: iksLead }, {
      headers: { Authorization: `Bearer ${IKS_TOKEN}` },
      timeout: 15000
    });

    // 6) ack to Google
    return res.status(200).json({});
  } catch (e) {
    console.error("IKS forward failed:", e?.response?.status, e?.response?.data || e.message);
    return res.status(502).json({ message: "Upstream error" });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Webhook listening"));
