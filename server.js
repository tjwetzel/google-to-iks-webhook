// server.js
// ----------------------------------------------------------------------------
// Render webhook for:
//   1) Google Lead Forms  -> Intellikids (/google-leads)
//   2) Duda site form     -> Intellikids (/duda-form)
// ----------------------------------------------------------------------------

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

// --- Body parsers: accept JSON and x-www-form-urlencoded (Duda uses this)
app.use(cors());
app.use(express.json());                         // application/json
app.use(express.urlencoded({ extended: true })); // application/x-www-form-urlencoded

// --- Healthcheck
app.get("/", (_req, res) => res.status(200).send("OK – webhook up"));

// ==== ENV ====================================================================
// Set these in Render "Environment" panel
const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY || "";      // shared key for /google-leads
const IKS_TOKEN       = process.env.IKS_TOKEN || "";             // Bearer token for Intellikids
const SOURCE_VALUE    = (process.env.SOURCE_VALUE || "Google Ads - Tanner").trim();
const FORCE_SOURCE    = (process.env.FORCE_SOURCE || "true").toLowerCase() === "true";

// If you kept the Google lead question id for location (not needed by Duda)
const LOCATION_QUESTION_COL_ID = "your_preferred_option";

// IKS base
const IKS_BASE = "https://api.intellikidsystems.com/api/v2";

// ==== Live IKS config (tenant-specific locations/sources) =====================
let LIVE_LOCATIONS = [];
let LIVE_SOURCES   = [];

async function loadConfig() {
  const r = await axios.get(`${IKS_BASE}/lead/config`, {
    headers: { Authorization: `Bearer ${IKS_TOKEN}` },
    timeout: 15000
  });
  const d = r.data || {};
  LIVE_LOCATIONS = Array.isArray(d.locations) ? d.locations : (d.data?.locations || []);
  LIVE_SOURCES   = Array.isArray(d.sources)   ? d.sources   : (d.data?.sources   || []);
  console.log("IKS config loaded:", {
    locations: LIVE_LOCATIONS.map(x => `${x.id}:${x.name}`).slice(0, 20),
    sources: LIVE_SOURCES
  });
}

async function ensureConfig() {
  if (!LIVE_LOCATIONS.length || !LIVE_SOURCES.length) await loadConfig();
}

// ==== Helpers =================================================================
const cols = (a = []) => a.reduce((o, c) => (o[c.column_id] = c.string_value, o), {});

const splitName = (full = "") => {
  const p = full.trim().split(/\s+/);
  return {
    first: p[0] || "Lead",
    last: p.slice(1).join(" ") || "From Website"
  };
};

const toE164 = (raw = "") =>
  raw.replace(/[^\d+0-9]/g, "").replace(/^1?(\d{10})$/, "+1$1");

// Scored fuzzy match of location text -> location.id (STRING)
function chooseLocationIdByText(t = "") {
  const s = (t || "").toLowerCase();
  if (!s) return null;

  const scoreFor = n => {
    const a = (n || "").toLowerCase();
    let sc = 0;
    if (s.includes("32nd")) sc += a.includes("32nd") ? 10 : 0;
    if (s.includes("moon")) sc += a.includes("moon") ? 5 : 0;
    if (s.includes("valley")) sc += a.includes("valley") ? 5 : 0;
    if (s.includes("midtown")) sc += a.includes("midtown") ? 6 : 0;
    if (s.includes("ahwatukee")) sc += a.includes("ahwatukee") ? 6 : 0;
    if (s.includes("mesa")) sc += a.includes("mesa") ? 6 : 0;
    if (s.includes("scottsdale")) sc += a.includes("scottsdale") ? 6 : 0;
    if (s.includes("phoenix")) sc += a.includes("phoenix") ? 2 : 0;
    return sc;
  };

  let best = null, bestScore = -1;
  for (const loc of LIVE_LOCATIONS) {
    const sc = scoreFor(loc.name);
    if (sc > bestScore) { best = loc; bestScore = sc; }
  }
  return best ? String(best.id) : null; // keep as STRING
}

// ==== Debug echo ==============================================================
app.post("/echo", (req, res) => {
  console.log("ECHO headers:", req.headers);
  console.log("ECHO body:", req.body);
  res.status(200).json({ ok: true });
});

// ==== Route: Google Lead Forms -> Intellikids =================================
app.post("/google-leads", async (req, res) => {
  try {
    if (req.body.google_key !== GOOGLE_LEAD_KEY) {
      return res.status(403).json({ message: "Invalid google_key" });
    }

    await ensureConfig();

    const c = cols(req.body.user_column_data || []);
    const full  = c.FULL_NAME || "";
    const email = c.EMAIL || "";
    const phone = c.PHONE_NUMBER || "";
    const answer = c[LOCATION_QUESTION_COL_ID] || ""; // visible label from the GLF question

    // Resolve location id
    let locationId = chooseLocationIdByText(answer);
    if (!locationId && LIVE_LOCATIONS.length) locationId = String(LIVE_LOCATIONS[0].id);

    // Source handling
    let source = SOURCE_VALUE;
    if (!FORCE_SOURCE) {
      source = LIVE_SOURCES.includes(SOURCE_VALUE) ? SOURCE_VALUE : (LIVE_SOURCES[0] || "Google");
    }

    const { first, last } = splitName(full || "Google Lead");

    const lead = {
      first_name: first,
      last_name:  last,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      source,
      location_id: locationId,
      location:    locationId,
      locations_select: answer
    };

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(lead)) if (v !== undefined && v !== null) qs.append(k, String(v));

    console.log("Posting to IKS (GLF):", qs.toString());

    await axios.post(`${IKS_BASE}/lead/simplified`, qs.toString(), {
      headers: { Authorization: `Bearer ${IKS_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });

    console.log("IKS OK (GLF)");
    return res.status(200).json({});
  } catch (e) {
    console.error("IKS error (GLF):", e?.response?.status, e?.response?.data || e.message);
    return res.status(502).json({ message: "Upstream error" });
  }
});

// ==== Route: Duda Site Form -> Intellikids ====================================
// Duda generally posts: { formId, pageUrl, date, data: [{label, value}, ...] }
function pickFromDuda(body = {}) {
  const out = { page_url: body.pageUrl || body.page_url || "" };
  const arr = Array.isArray(body.data) ? body.data : [];

  const get = (keys) => {
    const hit = arr.find(f => {
      const l = (f.label || f.fieldLabel || f.title || "").toLowerCase();
      return keys.some(k => l.includes(k));
    });
    return hit ? (hit.value || f.data || "") : "";
  };

  out.name     = body.name     || get(["name"]);
  out.email    = body.email    || get(["email"]);
  out.phone    = body.phone    || get(["phone","tel"]);
  out.location = body.location || get(["location","campus","school"]);
  // Optional marketing params if you add hidden fields in Duda later:
  out.utm_source   = body.utm_source   || "";
  out.utm_medium   = body.utm_medium   || "";
  out.utm_campaign = body.utm_campaign || "";
  out.utm_term     = body.utm_term     || "";
  out.utm_content  = body.utm_content  || "";
  out.gclid        = body.gclid        || "";
  return out;
}

app.post("/duda-form", async (req, res) => {
  try {
    console.log("DUDA hit -> headers:", req.headers);
    console.log("DUDA body:", req.body);

    await ensureConfig();

    const b = pickFromDuda(req.body || {});
    const { first, last } = splitName(b.name || "Website Lead");
    const phone = b.phone ? toE164(b.phone) : "";

    // Resolve location id from friendly label
    let locationId = chooseLocationIdByText(b.location);
    if (!locationId && LIVE_LOCATIONS.length) locationId = String(LIVE_LOCATIONS[0].id);

    // Source handling (re-use same policy)
    let source = SOURCE_VALUE;
    if (!FORCE_SOURCE) {
      source = LIVE_SOURCES.includes(SOURCE_VALUE) ? SOURCE_VALUE : (LIVE_SOURCES[0] || "Website");
    }

    const lead = {
      first_name: first,
      last_name:  last,
      ...(phone ? { phone } : {}),
      ...(b.email ? { email: b.email } : {}),
      source,
      location_id: locationId,
      location:    locationId,
      locations_select: b.location,
      // If your tenant supports "notes" this is useful for UTMs and page source
      notes: JSON.stringify({
        page_url: b.page_url || "",
        utm_source: b.utm_source || "",
        utm_medium: b.utm_medium || "",
        utm_campaign: b.utm_campaign || "",
        utm_term: b.utm_term || "",
        utm_content: b.utm_content || "",
        gclid: b.gclid || ""
      })
    };

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(lead)) if (v !== undefined && v !== null) qs.append(k, String(v));

    console.log("Posting to IKS (Duda):", qs.toString());

    await axios.post(`${IKS_BASE}/lead/simplified`, qs.toString(), {
      headers: { Authorization: `Bearer ${IKS_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });

    console.log("IKS OK (Duda)");
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Duda → IKS error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(502).json({ ok: false, message: "Upstream error" });
  }
});

// ==== Start server ============================================================
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Webhook listening on " + port));
