const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ type: "*/*" }));
app.get("/", (_, res) => res.status(200).send("OK"));

// ---------- ENV (Render → Environment) ----------
const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY || "";
const IKS_TOKEN = process.env.IKS_TOKEN || "";
const LOCATION_QUESTION_COL_ID = process.env.LOCATION_QUESTION_COL_ID || ""; // e.g. which_location_are_you_interested_in?
let CAMPAIGN_MAP = {};
try { CAMPAIGN_MAP = JSON.parse(process.env.CAMPAIGN_MAP_JSON || "{}"); } catch { CAMPAIGN_MAP = {}; }

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
  const byCity = textToLocationKey(cityText);         if
