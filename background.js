// ===== Config / Defaults =====
const DEFAULTS = {
  intervalMinutes: 5,
  autoArchiveDelivered: true,
  trackers: [] // {id, description, tracking, postcode, lastHash, lastText, lastWhen, lastCheckedAt, lastError, archived, history}
};

// ===== Small Utils =====
function uid() {
  try { return crypto.randomUUID(); } catch (_) { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}
function hashString(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return String(h); }
function deliveredLike(t = "") {
  return /delivered|received|bezorgd|geleverd|zustellt|ausgeliefert|livré|entregado|consegnato/i.test(t);
}
function notify(title, message, idPrefix = "gls") {
  const icon = chrome.runtime.getURL("icon128.png");
  try {
    chrome.notifications.create(`${idPrefix}-${Date.now()}`, { type: "basic", iconUrl: icon, title, message, priority: 2 });
  } catch (e) { console.warn("[GLS] Notification skipped:", e?.message || e); }
}
function getState() { return new Promise(r => chrome.storage.local.get(DEFAULTS, r)); }
function setState(patch) { return new Promise(r => chrome.storage.local.set(patch, r)); }
async function ensureAlarm() {
  const s = await getState();
  chrome.alarms.clear("poll");
  chrome.alarms.create("poll", { periodInMinutes: Math.max(1, Number(s.intervalMinutes) || 5) });
}

// Build GLS URL from tracking/postcode; convert spaces to '+'
function buildGlsUrl(tracking, postcode) {
  const t = encodeURIComponent(String(tracking || "").trim());
  const pc = encodeURIComponent(String(postcode || "").trim()).replace(/%20/g, "+");
  const millis = Date.now();
  return `https://gls-group.eu/app/service/open/rest/GROUP/en/rstt028/${t}?caller=witt002&millis=${millis}&postalCode=${pc}`;
}

// ===== Robust JSON event extractor (returns latest + full history) =====

// Build a human location suffix like " (Neuenstein, Germany)" if available
function formatLocation(ev) {
  const addr = ev.address || ev.addr || {};
  const city = addr.city || addr.town || addr.place || null;
  const countryName = addr.countryName || addr.country || null;
  const cc = addr.countryCode || addr.cc || null;

  const parts = [];
  if (city) parts.push(city);
  const country = countryName || cc || null;
  if (country) parts.push(country);

  return parts.length ? ` (${parts.join(", ")})` : "";
}

function normalizeEvent(ev) {
  const baseText = ev.evtDscr || ev.evtDsc || ev.evtDesc || ev.desc || ev.event || ev.message || "";
  const loc = formatLocation(ev);
  const text = `${String(baseText).trim()}${loc}`;

  const d = ev.date || ev.evtDate || ev.day || null;    // "2025-12-02"
  const t = ev.time || ev.evtTime || ev.hour || null;   // "14:30:08"
  const when = d && t ? `${d} ${t}` : (d || t || null);

  let ts = 0;
  if (d && t) ts = Date.parse(`${d}T${t}`);
  else if (d) ts = Date.parse(d);

  return { text, when, ts };
}
function isEventLike(x) {
  return x && typeof x === "object" && (
    "evtDscr" in x || "evtDsc" in x || "evtDesc" in x || "desc" in x || "event" in x || "message" in x
  );
}
function scanForEvents(obj, out = []) {
  const walk = (node) => {
    if (Array.isArray(node)) {
      if (node.length && node.some(isEventLike)) out.push(node);
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(walk);
    }
  };
  walk(obj);
  return out;
}

async function fetchLatestWithHistory(url) {
  const res = await fetch(url, {
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { "Accept": "application/json,text/plain;q=0.9,*/*;q=0.8" }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${body ? " :: " + body.slice(0, 200) : ""}`);
  }

  let data;
  try { data = await res.json(); }
  catch (_e) {
    const txt = await res.text();
    try { data = JSON.parse(txt); } catch { throw new Error("Invalid JSON response"); }
  }

  // Prefer common shape
  let arrays = [];
  if (Array.isArray(data?.tuStatus)) arrays = [data.tuStatus];
  else if (Array.isArray(data?.data?.tuStatus)) arrays = [data.data.tuStatus];
  else arrays = scanForEvents(data);

  if (!arrays.length) return { latestText: "No status yet", latestWhen: null, history: [] };

  // Flatten, normalize, sort newest->oldest
  const events = arrays.flat().filter(e => typeof e === "object").map(normalizeEvent);
  events.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const latest = events[0] || { text: "No status yet", when: null };
  // History newest first; include location baked into text
  const history = events
    .filter(e => e.text && e.text !== "No status yet")
    .map(e => (e.when ? `${e.when} – ${e.text}` : e.text));

  return { latestText: latest.text, latestWhen: latest.when, history };
}

// ===== Core check =====
async function checkOne(tr, cfg) {
  if (tr.archived) return tr;
  try {
    const url = buildGlsUrl(tr.tracking, tr.postcode);
    const { latestText, latestWhen, history } = await fetchLatestWithHistory(url);
    const signature = hashString((latestWhen ? latestWhen + " :: " : "") + latestText);

    tr.lastCheckedAt = new Date().toISOString();
    tr.lastError = null;
    tr.history = history; // store full history (with location)

    if (tr.lastHash !== signature) {
      tr.lastHash = signature;
      tr.lastText = latestText; // includes location
      tr.lastWhen = latestWhen;

      chrome.action.setBadgeText({ text: "NEW" });
      chrome.action.setBadgeBackgroundColor({ color: [0, 150, 136, 255] });

      // Desktop notification now includes location
      notify(tr.description ? `${tr.description} — status updated` : "GLS status updated",
             latestWhen ? `${latestWhen}\n${latestText}` : latestText,
             `gls-${tr.id}`);

      if (cfg.autoArchiveDelivered && deliveredLike(latestText)) {
        tr.archived = true;
        notify(tr.description || "GLS", "Delivered — archived.", `arch-${tr.id}`);
      }
    }
  } catch (e) {
    tr.lastCheckedAt = new Date().toISOString();
    tr.lastError = String(e?.message || e);
    tr.history = [];
    console.warn("[GLS] Check failed:", tr.description || tr.tracking, tr.lastError);
  }
  return tr;
}

async function checkAll(trigger = "alarm") {
  const s = await getState();
  const next = [];
  for (const tr of (s.trackers || [])) next.push(await checkOne({ ...tr }, s));
  await setState({ trackers: next });
  if (trigger !== "manual") setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
}

// ===== Lifecycle =====
chrome.runtime.onInstalled.addListener(async () => {
  const s = await getState();
  await setState({ ...DEFAULTS, ...s });
  await ensureAlarm();
  checkAll("install");
});
chrome.alarms.onAlarm.addListener(a => { if (a.name === "poll") checkAll("alarm"); });

// ===== Message Bus =====
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const s = await getState();

    try {
      if (msg?.type === "ADD_TRACKER") {
        const description = String(msg.description || "").trim();
        const tracking = String(msg.tracking || "").trim();
        const postcode = String(msg.postcode || "").trim();
        if (!tracking || !postcode) return sendResponse({ ok: false, error: "Tracking and post code are required." });

        const t = {
          id: uid(), description, tracking, postcode,
          lastHash: null, lastText: null, lastWhen: null,
          lastCheckedAt: null, lastError: null, archived: false, history: []
        };
        await setState({ trackers: [...(s.trackers || []), t] });
        return sendResponse({ ok: true, id: t.id });
      }

      if (msg?.type === "REMOVE_URL") {
        await setState({ trackers: (s.trackers || []).filter(t => t.id !== msg.id) });
        return sendResponse({ ok: true });
      }

      if (msg?.type === "TOGGLE_ARCHIVE") {
        const updated = (s.trackers || []).map(t => t.id === msg.id ? { ...t, archived: !t.archived } : t);
        await setState({ trackers: updated });
        return sendResponse({ ok: true });
      }

      if (msg === "CHECK_NOW") {
        await checkAll("manual");
        return sendResponse({ ok: true });
      }

      if (msg?.type === "SET_INTERVAL") {
        const minutes = Math.max(1, Number(msg.minutes) || 5);
        await setState({ intervalMinutes: minutes });
        await ensureAlarm();
        return sendResponse({ ok: true });
      }

      if (msg?.type === "SET_AUTO_ARCHIVE") {
        await setState({ autoArchiveDelivered: !!msg.value });
        return sendResponse({ ok: true });
      }

      if (msg === "GET_STATE") {
        return sendResponse(await getState());
      }
    } catch (e) {
      console.error("[GLS] onMessage error:", e);
      return sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true; // async
});

