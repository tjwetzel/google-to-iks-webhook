const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ type: "*/*" }));

const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY;
const IKS_TOKEN = process.env.IKS_TOKEN;
const IKS_BASE = "https://api.intellikidsystems.com/api/v2";

// Convert Google's array into { COLUMN_ID: "value", ... }
function columnsToObj(user_column_data = []) {
  const o = {};
  for (const c of user_column_data) o[c.column_id] = c.string_value;
  return o;
}

app.post("/google-leads", async (req, res) => {
  try {
    if (req.body.google_key !== GOOGLE_LEAD_KEY) {
      return res.status(403).json({ message: "Invalid google_key" });
    }

    const col = columnsToObj(req.body.user_column_data || []);

    // Map Google form fields
    const fullName   = col.FULL_NAME || "";
    const first      = col.FIRST_NAME || fullName.split(" ")[0] || "";
    const last       = col.LAST_NAME || fullName.replace(/^(\S+)\s*/, "") || "";
    const email      = col.EMAIL || "";
    const phone      = col.PHONE_NUMBER || "";
    const city       = col.CITY || "";
    const postalCode = col.POSTAL_CODE || "";
    const jobTitle   = col.JOB_TITLE || "";
    const enrollSoon = col.CUSTOM_QUESTION_1 || "";  // adjust if different ID
    const program    = col.CUSTOM_QUESTION_2 || "";  // adjust if different ID

    // IntelliKid lead object
    const iksLead = {
      first_name: first,
      last_name: last,
      email,
      phone,
      city,
      postal_code: postalCode,
      job_title: jobTitle,
      source: "Google Ads Lead Form",
      custom_fields: {
        enrollment_timing: enrollSoon,
        interested_program: program
      },
      notes: `GA lead_id: ${req.body.lead_id}`
    };

    await axios.post(`${IKS_BASE}/lead`, { lead: iksLead }, {
      headers: { Authorization: `Bearer ${IKS_TOKEN}` }
    });

    return res.status(200).json({});
  } catch (e) {
    console.error("IKS forward failed:",
      e?.response?.status, e?.response?.data || e.message);
    return res.status(502).json({ message: "Upstream error" });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Webhook listening")
);
