// sensor-simulator.js
// Gerçek RFID/NFC okuyucuların YERİNE geçici çalışır: POST /api/sensor-event
// endpoint'ine zaman gecikmeli (setTimeout) sahte event'ler gönderir.
//
// Kullanım: node sensor-simulator.js [senaryo]
// Senaryo verilmezse "normal" çalışır.

const API_URL = process.env.API_URL || "http://localhost:3000/api/sensor-event";
const API_KEY = "demo-havayolu-key-123";

async function sendEvent(tagId, checkpoint, { scannedFlightId, note } = {}) {
  const noteText = note ? ` (${note})` : "";
  console.log(`[sensör] ${tagId} -> ${checkpoint}${noteText}`);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ tagId, checkpoint, ...(scannedFlightId ? { scannedFlightId } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log(`[sensör]   -> HTTP ${res.status}: ${body.error || JSON.stringify(body)}`);
    } else if (body.alerts && body.alerts.length) {
      const lastAlert = body.alerts[body.alerts.length - 1];
      console.log(`[sensör]   -> alert: ${lastAlert.type}`);
    }
  } catch (err) {
    console.error(`[sensör]   -> istek başarısız: ${err.message} (backend çalışıyor mu?)`);
  }
}

function schedule(events) {
  for (const ev of events) {
    setTimeout(() => sendEvent(ev.tagId, ev.checkpoint, ev), ev.delay);
  }
  const totalMs = Math.max(...events.map((e) => e.delay)) + 300;
  setTimeout(() => console.log(`\n[sensör] Senaryo tamamlandı (${events.length} event gönderildi).`), totalMs);
}

// ---------------------------------------------------------------------------
// Senaryolar
// ---------------------------------------------------------------------------

const scenarios = {
  // 1) Tek uçuş, 3 bagaj, hiç anomali yok, business/first hedefi tutturuyor.
  normal() {
    console.log("[senaryo] normal — TK1982, 3 bagaj, sorunsuz akış, SLA tutturuluyor\n");
    schedule([
      { tagId: "TAG-2201", checkpoint: "check-in", delay: 0 },
      { tagId: "TAG-2202", checkpoint: "check-in", delay: 100 },
      { tagId: "TAG-2203", checkpoint: "check-in", delay: 200 },

      { tagId: "TAG-2201", checkpoint: "sorting", delay: 600 },
      { tagId: "TAG-2202", checkpoint: "sorting", delay: 700 },
      { tagId: "TAG-2203", checkpoint: "sorting", delay: 800 },

      { tagId: "TAG-2201", checkpoint: "loading", delay: 1200 },
      { tagId: "TAG-2202", checkpoint: "loading", delay: 1300 },
      { tagId: "TAG-2203", checkpoint: "loading", delay: 1400 },

      { tagId: "TAG-2201", checkpoint: "arrival-unload", delay: 1800 },
      { tagId: "TAG-2202", checkpoint: "arrival-unload", delay: 1900 },
      { tagId: "TAG-2203", checkpoint: "arrival-unload", delay: 2000 },

      // business hedefi 1300ms: 2900-1900=1000ms  -> SLA_MET
      { tagId: "TAG-2202", checkpoint: "carousel", delay: 2900 },
      // first hedefi 800ms: 2500-2000=500ms -> SLA_MET
      { tagId: "TAG-2203", checkpoint: "carousel", delay: 2500 },
      { tagId: "TAG-2201", checkpoint: "carousel", delay: 2400 },
    ]);
  },

  // 2) 4 bagaj, biri loading'te yanlış uçuşa okutuluyor -> MISROUTED.
  anomaly() {
    console.log("[senaryo] anomaly — TK1982, 4 bagaj, TAG-2204 yanlış uçuşa okutuluyor\n");
    schedule([
      { tagId: "TAG-2201", checkpoint: "check-in", delay: 0 },
      { tagId: "TAG-2202", checkpoint: "check-in", delay: 100 },
      { tagId: "TAG-2203", checkpoint: "check-in", delay: 200 },
      { tagId: "TAG-2204", checkpoint: "check-in", delay: 300 },

      { tagId: "TAG-2201", checkpoint: "sorting", delay: 600 },
      { tagId: "TAG-2202", checkpoint: "sorting", delay: 700 },
      { tagId: "TAG-2203", checkpoint: "sorting", delay: 800 },
      { tagId: "TAG-2204", checkpoint: "sorting", delay: 900 },

      { tagId: "TAG-2201", checkpoint: "loading", delay: 1200 },
      { tagId: "TAG-2202", checkpoint: "loading", delay: 1300 },
      { tagId: "TAG-2203", checkpoint: "loading", delay: 1400 },
      {
        tagId: "TAG-2204",
        checkpoint: "loading",
        delay: 1500,
        scannedFlightId: "TK4477",
        note: "kasıtlı yanlış uçuş — MISROUTED beklenir",
      },
    ]);
  },

  // 3) Business hedefi tutturuyor, first bagaj yer hizmetleri gecikmesiyle kaçırıyor.
  "missed-sla"() {
    console.log("[senaryo] missed-sla — business SLA_MET, first SLA_MISSED (dürüst raporlama demosu)\n");
    schedule([
      { tagId: "TAG-2202", checkpoint: "check-in", delay: 0 },
      { tagId: "TAG-2203", checkpoint: "check-in", delay: 100 },

      { tagId: "TAG-2202", checkpoint: "sorting", delay: 400 },
      { tagId: "TAG-2203", checkpoint: "sorting", delay: 500 },

      { tagId: "TAG-2202", checkpoint: "loading", delay: 800 },
      { tagId: "TAG-2203", checkpoint: "loading", delay: 900 },

      { tagId: "TAG-2202", checkpoint: "arrival-unload", delay: 1200 },
      { tagId: "TAG-2203", checkpoint: "arrival-unload", delay: 1300 },

      // business: 2300-1200=1100ms < 1300ms hedefi -> SLA_MET
      { tagId: "TAG-2202", checkpoint: "carousel", delay: 2300 },
      // first: 3200-1300=1900ms > 800ms hedefi -> SLA_MISSED (yer hizmetleri gecikmesi simülasyonu)
      {
        tagId: "TAG-2203",
        checkpoint: "carousel",
        delay: 3200,
        note: "yer hizmetleri gecikmesi simüle edildi",
      },
    ]);
  },

  // 4) İki uçuş (TK1982 + TK1984), 4 bagaj eş zamanlı, iç içe geçmiş akış.
  "multi-flight"() {
    console.log("[senaryo] multi-flight — TK1982 (2 bagaj) + TK1984 (2 bagaj) paralel akıyor\n");
    schedule([
      { tagId: "TAG-2201", checkpoint: "check-in", delay: 0 },
      { tagId: "TAG-4401", checkpoint: "check-in", delay: 150 },
      { tagId: "TAG-2202", checkpoint: "check-in", delay: 250 },
      { tagId: "TAG-4402", checkpoint: "check-in", delay: 400 },

      { tagId: "TAG-4401", checkpoint: "sorting", delay: 700 },
      { tagId: "TAG-2201", checkpoint: "sorting", delay: 800 },
      { tagId: "TAG-4402", checkpoint: "sorting", delay: 950 },
      { tagId: "TAG-2202", checkpoint: "sorting", delay: 1050 },

      { tagId: "TAG-2201", checkpoint: "loading", delay: 1400 },
      { tagId: "TAG-4401", checkpoint: "loading", delay: 1500 },
      { tagId: "TAG-2202", checkpoint: "loading", delay: 1600 },
      { tagId: "TAG-4402", checkpoint: "loading", delay: 1700 },

      { tagId: "TAG-4401", checkpoint: "arrival-unload", delay: 2000 },
      { tagId: "TAG-2201", checkpoint: "arrival-unload", delay: 2100 },
      { tagId: "TAG-4402", checkpoint: "arrival-unload", delay: 2200 },
      { tagId: "TAG-2202", checkpoint: "arrival-unload", delay: 2300 },

      { tagId: "TAG-4401", checkpoint: "carousel", delay: 2900 },
      { tagId: "TAG-2201", checkpoint: "carousel", delay: 3000 },
      { tagId: "TAG-4402", checkpoint: "carousel", delay: 3100 },
      { tagId: "TAG-2202", checkpoint: "carousel", delay: 3200 },
    ]);
  },

  // 5) Dört uç durum: tekrar okuma, kayıtsız etiket, checkpoint atlama, kayıp bagaj.
  "edge-cases"() {
    console.log("[senaryo] edge-cases — tekrar okuma / kayıtsız etiket / checkpoint atlama / kayıp bagaj\n");
    schedule([
      // (a) aynı checkpoint için aynı tagId'ye iki kez event — idempotency testi
      { tagId: "TAG-2201", checkpoint: "check-in", delay: 0, note: "(a) ilk okuma" },
      { tagId: "TAG-2201", checkpoint: "check-in", delay: 400, note: "(a) tekrar okuma — aynı checkpoint" },

      // (b) sistemde kayıtlı olmayan tagId — 404 beklenir
      { tagId: "TAG-9999", checkpoint: "check-in", delay: 800, note: "(b) kayıtsız etiket — 404 beklenir" },

      // (c) sorting hiç görülmeden direkt loading'e gönderme — checkpoint atlanması
      {
        tagId: "TAG-2202",
        checkpoint: "check-in",
        delay: 1200,
        note: "(c) hazırlık",
      },
      {
        tagId: "TAG-2202",
        checkpoint: "loading",
        delay: 1600,
        note: "(c) sorting atlandı — sensör senkron hatası simülasyonu",
      },

      // (d) bir bagajı sadece check-in'de bırak, hiç ilerletme — kayıp bagaj senaryosu
      { tagId: "TAG-2204", checkpoint: "check-in", delay: 2000, note: "(d) kayıp bagaj — bir daha hiç okutulmayacak" },
    ]);
  },

  // 6) Kısa sürede yoğun trafik: 25-30 event + kayıtsız-etiket gürültüsü.
  stress() {
    console.log("[senaryo] stress — birkaç saniyede 25-30 event + gürültü\n");
    const tagIds = ["TAG-2201", "TAG-2202", "TAG-2203", "TAG-2204", "TAG-4401", "TAG-4402"];
    const checkpoints = ["check-in", "sorting", "loading", "arrival-unload", "carousel"];
    const events = [];
    let delay = 0;

    // Her bagaj için tüm checkpoint'leri sırayla, sıkışık aralıklarla gönder (30 event).
    for (const tagId of tagIds) {
      for (const checkpoint of checkpoints) {
        delay += 120 + Math.floor(Math.random() * 80);
        events.push({ tagId, checkpoint, delay });
      }
    }

    // Araya birkaç kayıtsız-etiket "gürültüsü" karıştır.
    const noiseTags = ["TAG-0001", "TAG-0002", "TAG-0003"];
    noiseTags.forEach((tagId, i) => {
      events.push({
        tagId,
        checkpoint: "check-in",
        delay: 500 + i * 900,
        note: "gürültü — kayıtsız etiket",
      });
    });

    events.sort((a, b) => a.delay - b.delay);
    schedule(events);
  },
};

// ---------------------------------------------------------------------------
// Çalıştırma
// ---------------------------------------------------------------------------

const scenarioName = process.argv[2] || "normal";
const scenarioFn = scenarios[scenarioName];

if (!scenarioFn) {
  console.error(`Bilinmeyen senaryo: "${scenarioName}"`);
  console.error(`Kullanılabilir senaryolar: ${Object.keys(scenarios).join(", ")}`);
  process.exit(1);
}

scenarioFn();
