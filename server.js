const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json({ type: "*/*" }));
app.get("/", (_,res)=>res.status(200).send("OK"));

const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY || "";
const IKS_TOKEN = process.env.IKS_TOKEN || "";
const LOCATION_QUESTION_COL_ID = process.env.LOCATION_QUESTION_COL_ID || ""; // your_preferred_option

// IKS constants
const IKS_BASE = "https://api.intellikidsystems.com/api/v2";
const IDS = {
  moon_valley: "1031842527598690591",
  midtown:     "869433737132249695",
  ahwatukee:   "768926818228114422",
  mesa:        "768926817510891380",
  scottsdale:  "768926815564732288",
  phoenix:     "768926813861845343"
};

// helpers
const cols = (a=[]) => a.reduce((o,c)=> (o[c.column_id]=c.string_value,o),{});
const keyFromText = (t="")=>{
  t = t.toLowerCase();
  if (t.includes("moon")) return "moon_valley";
  if (t.includes("midtown")) return "midtown";
  if (t.includes("ahwatukee")) return "ahwatukee";
  if (t.includes("mesa")) return "mesa";
  if (t.includes("scottsdale")) return "scottsdale";
  if (t.includes("phoenix")) return "phoenix";
  return "phoenix";
};

app.post("/google-leads", async (req,res)=>{
  try{
    if (req.body.google_key !== GOOGLE_LEAD_KEY) return res.status(403).json({message:"Invalid google_key"});

    const c = cols(req.body.user_column_data);
    const full = c.FULL_NAME || "";
    const first = c.FIRST_NAME || full.split(" ")[0] || "Lead";
    const last  = c.LAST_NAME  || full.replace(/^(\S+)\s*/,"") || "From Google";
    const email = c.EMAIL || "";
    const phone = c.PHONE_NUMBER || "";
    const answer = LOCATION_QUESTION_COL_ID ? (c[LOCATION_QUESTION_COL_ID]||"") : "";
    const locKey = keyFromText(answer);
    const idStr  = IDS[locKey];
    const idNum  = Number(idStr);

    // MINIMAL + bulletproof: send BOTH keys
    const payload = {
      first_name: first,
      last_name:  last,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      source: "Google Ads - Tanner",
      location_id: idNum,
      location:    idNum
    };

    const qs = new URLSearchParams();
    for (const [k,v] of Object.entries(payload)) qs.append(k,String(v));

    console.log("Sending to IKS:", qs.toString());

    const r = await axios.post(`${IKS_BASE}/lead/simplified`, qs.toString(), {
      headers: { Authorization: `Bearer ${IKS_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });

    console.log("IKS OK:", r.status);
    return res.status(200).json({});
  }catch(e){
    console.error("IKS error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(502).json({message:"Upstream error"});
  }
});

app.listen(process.env.PORT || 3000, ()=>console.log("Webhook listening"));
