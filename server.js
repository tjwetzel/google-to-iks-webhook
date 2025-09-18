const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json({ type: "*/*" }));
app.get("/", (_,res)=>res.status(200).send("OK"));

// --- ENV ---
const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY || "";
const IKS_TOKEN = process.env.IKS_TOKEN || "";
const LOCATION_QUESTION_COL_ID = process.env.LOCATION_QUESTION_COL_ID || ""; // your_preferred_option
const SOURCE_VALUE = (process.env.SOURCE_VALUE || "Google Ads - Tanner").trim();

// --- IKS ---
const IKS_BASE = "https://api.intellikidsystems.com/api/v2";

// EXACT labels from your IKS dropdown + their numeric IDs
const LOCS = {
  phoenix:     { id:"768926813861845343", label:"Whiz Kidz Phoenix" },
  scottsdale:  { id:"768926815564732288", label:"Whiz Kidz Scottsdale" },
  mesa:        { id:"768926817510891380", label:"Whiz Kidz Mesa" },
  ahwatukee:   { id:"768926818228114422", label:"Whiz Kidz Preschool Ahwatukee" },
  midtown:     { id:"869433737132249695", label:"Whiz Kidz Midtown" },
  moon_valley: { id:"1031842527598690591",label:"Whiz Kidz Preschool Moon Valley" },
};

// your custom field system names in IKS
const FIELD_LOC_SELECT  = "locations_select";
const FIELD_LOC_CHECKS  = "location_checkboxes";

// --- helpers ---
const toMap = (a=[]) => a.reduce((o,c)=> (o[c.column_id]=c.string_value,o),{});
function inferKey(t=""){
  const a=t.toLowerCase();
  if (a.includes("moon")) return "moon_valley";
  if (a.includes("midtown")) return "midtown";
  if (a.includes("ahwatukee")) return "ahwatukee";
  if (a.includes("mesa")) return "mesa";
  if (a.includes("scottsdale")) return "scottsdale";
  if (a.includes("phoenix")) return "phoenix";
  return "phoenix";
}
function pickLoc({answer,campaignName,city}) {
  return LOCS[inferKey(answer || campaignName || city)];
}

app.post("/google-leads", async (req,res)=>{
  try{
    if (req.body.google_key !== GOOGLE_LEAD_KEY) return res.status(403).json({message:"Invalid google_key"});

    const c = toMap(req.body.user_column_data);
    const full = c.FULL_NAME || "";
    const first = c.FIRST_NAME || full.split(" ")[0] || "Lead";
    const last  = c.LAST_NAME  || full.replace(/^(\S+)\s*/,"") || "From Google";
    const email = c.EMAIL || "";
    const phone = c.PHONE_NUMBER || "";
    const answer = LOCATION_QUESTION_COL_ID ? (c[LOCATION_QUESTION_COL_ID]||"") : "";
    const campaignName = req.body.campaign_name || "";
    const city = c.CITY || "";

    const loc = pickLoc({answer, campaignName, city});
    const idNum = Number(loc.id);

    // Minimal + bulletproof core fields
    const core = {
      first_name: first,
      last_name:  last,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      source: SOURCE_VALUE,                 // exact allowed value
      location_id: idNum,                   // numeric ID
      location: idNum                       // also as "location" for picky tenants
    };

    // Add your custom UI fields with EXACT labels
    const custom = {
      [FIELD_LOC_SELECT]:  loc.label,
      [FIELD_LOC_CHECKS]:  loc.label
    };

    // ---- Try simplified form first (least picky) ----
    const qs = new URLSearchParams();
    for (const [k,v] of Object.entries(core)) qs.append(k,String(v));
    for (const [k,v] of Object.entries(custom)) if (v) qs.append(k,String(v));

    console.log("Sending:", qs.toString());

    await axios.post(`${IKS_BASE}/lead/simplified`, qs.toString(), {
      headers: { Authorization: `Bearer ${IKS_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });

    console.log("IKS OK");
    return res.status(200).json({});
  }catch(e){
    console.error("IKS error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(502).json({message:"Upstream error"});
  }
});

app.listen(process.env.PORT || 3000, ()=>console.log("Webhook listening"));
