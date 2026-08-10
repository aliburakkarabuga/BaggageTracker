// server.js
// Bagaj Takip Sistemi — Backend (Express + WebSocket)
//
// Mimari ilke: tek bir sensör giriş noktası var (POST /api/sensor-event).
// Gerçek donanım geldiğinde bu dosyanın HİÇBİR satırı değişmeden, sadece
// o endpoint'e POST atan yeni bir okuyucu/bridge eklenmesi yeterli olmalı.

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const API_KEY = "demo-havayolu-key-123";
const ADMIN_USER = "operasyon";
const ADMIN_PASS = "demo1234";

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "bags-state.json");

const CHECKPOINTS = ["check-in", "sorting", "loading", "arrival-unload", "carousel"];

// SLA hedefleri (ms) — demo amaçlı hızlı görülsün diye milisaniye, gerçek
// üründe dakika cinsinden olur.
const SLA_TARGET_MS = { business: 1300, first: 800 };

// ---------------------------------------------------------------------------
// Veri modeli / demo manifest
// ---------------------------------------------------------------------------

const MANIFEST = [
  { tagId: "TAG-2201", passenger: "A. Kaya", flightId: "TK1982", passengerClass: "economy" },
  { tagId: "TAG-2202", passenger: "S. Demir", flightId: "TK1982", passengerClass: "business" },
  { tagId: "TAG-2203", passenger: "E. Yıldız", flightId: "TK1982", passengerClass: "first" },
  { tagId: "TAG-2204", passenger: "M. Aydın", flightId: "TK1982", passengerClass: "economy" },
  { tagId: "TAG-4401", passenger: "N. Şahin", flightId: "TK1984", passengerClass: "business" },
  { tagId: "TAG-4402", passenger: "C. Arslan", flightId: "TK1984", passengerClass: "economy" },
];

/** @type {Map<string, object>} */
const bags = new Map();

function freshBag(manifestEntry) {
  return {
    tagId: manifestEntry.tagId,
    passenger: manifestEntry.passenger,
    flightId: manifestEntry.flightId,
    passengerClass: manifestEntry.passengerClass,
    checkpoint: null,
    priority: manifestEntry.passengerClass === "business" || manifestEntry.passengerClass === "first",
    alerts: [],
    history: [],
    // arrival-unload zaman damgası SLA hesaplaması için tutulur, dışarı da
    // döndürülür ama sadece iç mantık için önemli.
    _arrivalUnloadAt: null,
  };
}

function resetBagsToInitial() {
  bags.clear();
  for (const entry of MANIFEST) {
    bags.set(entry.tagId, freshBag(entry));
  }
}

resetBagsToInitial();

// ---------------------------------------------------------------------------
// Kalıcılık (data/bags-state.json)
// ---------------------------------------------------------------------------

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function persistState() {
  ensureDataDir();
  const serializable = Array.from(bags.values()).map((b) => ({
    tagId: b.tagId,
    checkpoint: b.checkpoint,
    alerts: b.alerts,
    history: b.history,
    _arrivalUnloadAt: b._arrivalUnloadAt,
  }));
  fs.writeFileSync(STATE_FILE, JSON.stringify(serializable, null, 2), "utf-8");
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return;
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const saved = JSON.parse(raw);
    for (const savedBag of saved) {
      const bag = bags.get(savedBag.tagId);
      if (!bag) continue; // manifest'te yoksa yok say (eski/silinmiş kayıt)
      bag.checkpoint = savedBag.checkpoint ?? null;
      bag.alerts = savedBag.alerts ?? [];
      bag.history = savedBag.history ?? [];
      bag._arrivalUnloadAt = savedBag._arrivalUnloadAt ?? null;
    }
    console.log(`[state] data/bags-state.json okunup ${saved.length} bagaj geri yüklendi.`);
  } catch (err) {
    console.error("[state] bags-state.json okunamadı, temiz durumda başlanıyor:", err.message);
  }
}

loadState();

// ---------------------------------------------------------------------------
// Webhook registry (basit array — kayıtlı URL'lere her alert'te POST atılır)
// ---------------------------------------------------------------------------

/** @type {string[]} */
const webhookUrls = [];

async function pushToWebhooks(payload) {
  for (const url of webhookUrls) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error(`[webhook] ${url} adresine push başarısız:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocket yayını
// ---------------------------------------------------------------------------

function broadcast(message) {
  const json = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(json);
  }
}

function publicBag(bag) {
  // _arrivalUnloadAt dışa sızmasın, iç kullanım.
  const { _arrivalUnloadAt, ...rest } = bag;
  return rest;
}

// ---------------------------------------------------------------------------
// İş mantığı: bir checkpoint event'i işlenince alert üretimi
// ---------------------------------------------------------------------------

function addAlert(bag, type, severity, message) {
  const alert = { type, severity, message, timestamp: new Date().toISOString() };
  bag.alerts.push(alert);
  return alert;
}

function applyCheckpointEvent(bag, checkpoint, scannedFlightId) {
  const now = new Date().toISOString();
  bag.checkpoint = checkpoint;
  bag.history.push({ checkpoint, timestamp: now, ...(scannedFlightId ? { scannedFlightId } : {}) });

  const newAlerts = [];

  if (checkpoint === "sorting" && bag.priority) {
    newAlerts.push(addAlert(bag, "SORT_COMMAND", "info", "Öncelikli bagaj — ayırma komutu tetiklendi."));
  }

  if (checkpoint === "arrival-unload") {
    bag._arrivalUnloadAt = Date.now();
    if (bag.priority) {
      newAlerts.push(addAlert(bag, "PRIORITY_LANE", "info", "Öncelikli şeride yönlendirildi."));
    }
  }

  if (checkpoint === "loading" && scannedFlightId && scannedFlightId !== bag.flightId) {
    newAlerts.push(
      addAlert(
        bag,
        "MISROUTED",
        "critical",
        `Bagaj ${scannedFlightId} uçuşuna okutuldu, atanmış uçuş ${bag.flightId}.`
      )
    );
  }

  if (checkpoint === "carousel" && bag.priority && bag._arrivalUnloadAt) {
    const elapsedMs = Date.now() - bag._arrivalUnloadAt;
    const target = SLA_TARGET_MS[bag.passengerClass];
    if (target != null) {
      if (elapsedMs <= target) {
        newAlerts.push(addAlert(bag, "SLA_MET", "info", `Hedef tutturuldu (${elapsedMs}ms / ${target}ms).`));
      } else {
        newAlerts.push(addAlert(bag, "SLA_MISSED", "warning", `Hedef kaçırıldı (${elapsedMs}ms / ${target}ms).`));
      }
    }
  }

  return newAlerts;
}

// ---------------------------------------------------------------------------
// Auth: iki ayrı katman
//   1) Partner API key (x-api-key) — /api/* route'ları için
//   2) Ops session login (operasyon/demo1234) — sadece /dashboard.html için
// ---------------------------------------------------------------------------

/** @type {Set<string>} */
const sessions = new Set();

function requireApiKey(req, res, next) {
  if (req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ error: "Geçersiz veya eksik x-api-key." });
  }
  next();
}

app.use(express.json());
app.use(cookieParser());

// --- Dashboard koruması — static servisten ÖNCE tanımlanmalı ---
app.get("/dashboard.html", (req, res, next) => {
  const sid = req.cookies?.sid;
  if (!sid || !sessions.has(sid)) {
    return res.redirect("/login.html");
  }
  next();
});

// --- Statik dosyalar (login.html, passenger.html, mobil demo sayfaları vb.) ---
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Auth endpoint'leri
// ---------------------------------------------------------------------------

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const sid = crypto.randomUUID();
    sessions.add(sid);
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax" });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
});

app.post("/auth/logout", (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) sessions.delete(sid);
  res.clearCookie("sid");
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Partner API — hepsi x-api-key gerektirir
// ---------------------------------------------------------------------------

app.post("/api/sensor-event", requireApiKey, async (req, res) => {
  const { tagId, checkpoint, scannedFlightId } = req.body || {};
  const bag = bags.get(tagId);
  if (!bag) {
    return res.status(404).json({ error: `Kayıtlı bagaj bulunamadı: ${tagId}` });
  }
  if (!CHECKPOINTS.includes(checkpoint)) {
    return res.status(400).json({ error: `Geçersiz checkpoint: ${checkpoint}` });
  }

  const newAlerts = applyCheckpointEvent(bag, checkpoint, scannedFlightId);
  persistState();
  broadcast({ type: "event", bag: publicBag(bag) });

  for (const alert of newAlerts) {
    await pushToWebhooks({ tagId: bag.tagId, alert, bag: publicBag(bag) });
  }

  res.json(publicBag(bag));
});

app.get("/api/bags", requireApiKey, (req, res) => {
  res.json(Array.from(bags.values()).map(publicBag));
});

app.post("/api/bags/:tagId/flag", requireApiKey, async (req, res) => {
  const bag = bags.get(req.params.tagId);
  if (!bag) {
    return res.status(404).json({ error: `Kayıtlı bagaj bulunamadı: ${req.params.tagId}` });
  }
  const { note } = req.body || {};
  const alert = addAlert(bag, "MANUAL_FLAG", "critical", note || "Manuel olarak incelemeye alındı.");
  persistState();
  broadcast({ type: "event", bag: publicBag(bag) });
  await pushToWebhooks({ tagId: bag.tagId, alert, bag: publicBag(bag) });
  res.json(publicBag(bag));
});

app.post("/api/reset", requireApiKey, (req, res) => {
  resetBagsToInitial();
  persistState();
  broadcast({ type: "reset" });
  res.json({ ok: true });
});

// Basit webhook kaydı (spesifikasyonda "kayıtlı webhook'lar" geçtiği için
// eklendi — havayolunun backend'i kendi alert push URL'ini buraya kaydeder).
app.post("/api/webhooks", requireApiKey, (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "url alanı zorunlu." });
  webhookUrls.push(url);
  res.json({ ok: true, registered: webhookUrls.length });
});

server.listen(PORT, () => {
  console.log(`[server] Bagaj Takip backend çalışıyor: http://localhost:${PORT}`);
  console.log(`[server] Ops girişi: /login.html  (operasyon / demo1234)`);
  console.log(`[server] Yolcu ekranı: /passenger.html`);
});
