// server.js
// ----------------------------------------------------------------------------
// Render webhook for:
//   1) Google Lead Forms  -> Intellikids (/google-leads)
//   2) Duda site form     -> Intellikids (/duda-form)
// ----------------------------------------------------------------------------

const express = require("express");
const axios = require("axios");

const app = express();

// Body parsers
app.use(express.json());                         // application/json
app.use(express.urlencoded({ extended: true })); // application/x-www-form-urlencoded

// Healthcheck
app.get("/", (_req, res) => res.status(200).send("OK – webhook up"));

// ===== ENV (set these in Render) =============================================
// GOOGLE_LEAD_KEY = some-secret-key
// IKS_TOKEN       = <your Intellikids API token>
// SOURCE_VALUE    = Google Ads - Tanner
// FORCE_SOURCE    = true
const GOOGLE_LEAD_KEY = process.env.GOOGLE_LEAD_KEY || "";
const IKS_TOKEN       = process.env.IKS_TOKEN || "";
const SOURCE_VALUE    = (process.env.SOURCE_VALUE || "Google Ads - Tanner").trim();
const FORCE_SOURCE    = (process.env.FORCE_SOURCE || "true").toLowerCase() === "true";

// Google Lead Form location question ID
const LOCATION_QUESTION_COL_ID = "your_preferred_option";

// Intellikids API base
const IKS_BASE = "https://api.intellikidsystems.com/api/v2";

// ===== Live IKS config =======================================================
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

// ===== Helpers ===============================================================
const cols = (a = []) => a.reduce((o, c) => (o[c.column_id] = c.string_value, o), {});

const splitName = (full = "") => {
  const p = String(full || "").trim().split(/\s+/);
  return { first: p[0] || "Lead", last: p.slice(1).join(" ") || "From Website" };
};

const toE164 = (raw = "") =>
  String(raw || "").replace(/[^\d+0-9]/g, "").replace(/^1?(\d{10})$/, "+1$1");

// Scored fuzzy match of location label -> location.id (STRING)
function chooseLocationIdByText(t = "") {
  const s = (t || "").toLowerCase();
  if (!s) return null;

  const scoreFor = n => {
    const a = (n || "").toLowerCase();
    let sc = 0;
    if (s.includes("ahwatukee")) sc += a.includes("ahwatukee") ? 20 : 0;
    if (s.includes("midtown")) sc += a.includes("midtown") ? 18 : 0;
    if (s.includes("moon")) sc += a.includes("moon") ? 16 : 0;
    if (s.includes("mesa")) sc += a.includes("mesa") ? 14 : 0;
    if (s.includes("scottsdale")) sc += a.includes("scottsdale") ? 12 : 0;
    if (s.includes("phoenix")) sc += a.includes("phoenix") ? 10 : 0;
    if (s.includes("valley")) sc += a.includes("valley") ? 6 : 0;
    if (s.includes("32nd")) sc += a.includes("32nd") ? 6 : 0;
    return sc;
  };

  let best = null, bestScore = -1;
  for (const loc of LIVE_LOCATIONS) {
    const sc = scoreFor(loc.name);
    if (sc > bestScore) { best = loc; bestScore = sc; }
  }
  return best ? String(best.id) : null;
}

// Debug echo
app.post("/echo", (req, res) => {
  console.log("ECHO headers:", req.headers);
  console.log("ECHO body:", req.body);
  res.status(200).json({ ok: true });
});

// ===== Route: Google Lead Forms =============================================
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
    const answer = c[LOCATION_QUESTION_COL_ID] || "";

    let locationId = chooseLocationIdByText(answer);
    if (!locationId && LIVE_LOCATIONS.length) locationId = String(LIVE_LOCATIONS[0].id);

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
    for (const [k, v] of Object.entries(lead)) if (v) qs.append(k, String(v));

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

// ===== Route: Duda Site Form ================================================
// Supports BOTH shapes:
// A) Flat keys: {"Name *":"…","Email *":"…","Phone *":"…","Select Location *":"…"}
// B) Array: { data:[{label:"Name *",value:"…"}, ...], pageUrl:"…" }
function pickFromDuda(body = {}) {
  const flat = {
    name:     body["Name *"] || body["Full Name"] || body["Name"] || body.name || "",
    email:    body["Email *"] || body["Email"] || body.email || "",
    phone:    body["Phone *"] || body["Phone"] || body.phone || "",
    location: body["Select Location *"] || body["Location"] || body.location || "",
    page_url: body.pageUrl || body.page_url || ""
  };

  // If flat keys produced values, use them
  if (flat.name || flat.email || flat.phone || flat.location) return flat;

  // Otherwise, try array format
  const arr = Array.isArray(body.data) ? body.data : [];
  const get = (labels) => {
    const hit = arr.find(f => labels.some(k => (f.label || f.fieldLabel || f.title || "").toLowerCase().includes(k)));
    return hit ? (hit.value || "") : "";
  };

  return {
    name:     get(["name"]),
    email:    get(["email"]),
    phone:    get(["phone","tel"]),
    location: get(["location","campus","school"]),
    page_url: body.pageUrl || ""
  };
}

app.post("/duda-form", async (req, res) => {
  try {
    console.log("DUDA hit -> headers:", req.headers);
    console.log("DUDA body:", req.body);

    await ensureConfig();

    const b = pickFromDuda(req.body || {});
    const { first, last } = splitName(b.name || "Website Lead");
    const phoneE164 = b.phone ? toE164(b.phone) : "";

    // Resolve location id
    let locationId = chooseLocationIdByText(b.location);
    if (!locationId && LIVE_LOCATIONS.length) locationId = String(LIVE_LOCATIONS[0].id);

    // Source handling
    let source = SOURCE_VALUE;
    if (!FORCE_SOURCE) {
      source = LIVE_SOURCES.includes(SOURCE_VALUE) ? SOURCE_VALUE : (LIVE_SOURCES[0] || "Website");
    }

    const lead = {
      first_name: first,
      last_name:  last,
      ...(phoneE164 ? { phone: phoneE164 } : {}),
      ...(b.email ? { email: b.email } : {}),
      source,
      location_id: locationId,
      location:    locationId,
      locations_select: b.location,
      notes: `From Duda | ${b.page_url || ""}`
    };

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(lead)) if (v !== undefined && v !== null) qs.append(k, String(v));

    console.log("Resolved -> name:", first, last, "| email:", b.email || "(none)", "| phone:", phoneE164 || "(none)", "| locLabel:", b.location || "(none)", "| locId:", locationId);
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

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Webhook listening on " + port));
