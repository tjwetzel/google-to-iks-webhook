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
    if (s.includes("midtown")   &
