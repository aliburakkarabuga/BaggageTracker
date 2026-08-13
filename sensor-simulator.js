// sensor-simulator.js
// Gerçek RFID/NFC okuyucuların YERİNE geçici çalışır: POST /api/sensor-event
// endpoint'ine zaman gecikmeli (setTimeout) sahte event'ler gönderir.
//
// Kullanım: node sensor-simulator.js [senaryo]
// Senaryo verilmezse "normal" çalışır.

const API_URL = process.env.API_URL || "http://localhost:3000/api/sensor-event";
const API_KEY = "demo-havayolu-key-123";
const BASE_URL = API_URL.replace(/\/api\/sensor-event$/, "");

async function sendEvent(tagId, checkpoint, { scannedFlightId, note, quiet, progress } = {}) {
  if (!quiet) {
    const noteText = note ? ` (${note})` : "";
    console.log(`[sensör] ${tagId} -> ${checkpoint}${noteText}`);
  }
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ tagId, checkpoint, ...(scannedFlightId ? { scannedFlightId } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log(`[sensör]   -> HTTP ${res.status} (${tagId}): ${body.error || JSON.stringify(body)}`);
    } else if (body.alerts && body.alerts.length) {
      const lastAlert = body.alerts[body.alerts.length - 1];
      console.log(`[sensör]   -> alert: ${lastAlert.type} (${tagId})`);
    }
  } catch (err) {
    console.error(`[sensör]   -> istek başarısız: ${err.message} (backend çalışıyor mu?)`);
  } finally {
    if (progress) {
      progress.done++;
      if (progress.done % progress.every === 0 || progress.done === progress.total) {
        console.log(`[sensör] ... ${progress.done}/${progress.total} event işlendi`);
      }
    }
  }
}

function schedule(events) {
  for (const ev of events) {
    setTimeout(() => sendEvent(ev.tagId, ev.checkpoint, ev), ev.delay);
  }
  const totalMs = Math.max(...events.map((e) => e.delay)) + 300;
  setTimeout(() => console.log(`\n[sensör] Senaryo tamamlandı (${events.length} event gönderildi).`), totalMs);
  return totalMs;
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

  // 7) Gerçek bir uçuştaki gibi ~100 yolcunun bagajı: backend'i 100 bagajla
  // "seed" eder, sonra check-in kuyruğundan banda kadar gerçekçi, dağınık
  // zamanlamalarla akıtır. Birkaç MISROUTED ve bir kayıp bagaj da içerir.
  async "realistic-100"() {
    console.log("[senaryo] realistic-100 — ~100 yolculuk gerçek bir uçuş simülasyonu\n");

    const FLIGHT_ID = "TK1982";
    const BAG_COUNT = 100;

    console.log(`[sensör] backend ${BAG_COUNT} bagajla seed ediliyor (uçuş: ${FLIGHT_ID})...`);
    const seedRes = await fetch(`${BASE_URL}/api/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ count: BAG_COUNT, flightId: FLIGHT_ID }),
    });
    if (!seedRes.ok) {
      console.error("[sensör] seed başarısız oldu, backend çalışıyor mu?");
      return;
    }
    const bagsRes = await fetch(`${BASE_URL}/api/bags`, { headers: { "x-api-key": API_KEY } });
    const allBags = await bagsRes.json();
    console.log(`[sensör] ${allBags.length} bagaj yüklendi, akış başlıyor...\n`);

    const rand = (min, max) => min + Math.random() * (max - min);

    // 1. geçiş: check-in / sorting / loading gecikmelerini hesapla
    const timings = allBags.map((bag) => {
      const checkIn = rand(0, 30000); // 30 saniyelik check-in kuyruğu penceresi
      const sorting = checkIn + rand(3000, 9000);
      const loading = sorting + rand(3000, 9000);
      return { bag, checkIn, sorting, loading };
    });

    // "Uçuş" en son yüklenen bagajdan sonra kalkıyor kabul ediliyor,
    // sabit bir "uçuş süresi" simüle ediyoruz (demo amaçlı kısaltılmış).
    const lastLoading = Math.max(...timings.map((t) => t.loading));
    const FLIGHT_DURATION_MS = 20000;
    const landingBase = lastLoading + FLIGHT_DURATION_MS;

    // Kayıp bagaj ve yanlış-uçuş senaryoları için birkaç bagajı işaretle
    const shuffled = [...timings].sort(() => Math.random() - 0.5);
    const lostBags = new Set(shuffled.slice(0, 2).map((t) => t.bag.tagId));
    const misroutedBags = new Set(
      shuffled
        .slice(2, 5)
        .filter((t) => t.bag.passengerClass === "economy")
        .map((t) => t.bag.tagId)
    );

    const events = [];
    const progress = { done: 0, total: 0, every: 25 };

    for (const t of timings) {
      const { bag, checkIn, sorting, loading } = t;

      events.push({ tagId: bag.tagId, checkpoint: "check-in", delay: checkIn, quiet: true, progress });

      if (lostBags.has(bag.tagId)) {
        continue; // kayıp bagaj: check-in'den sonra bir daha hiç okutulmuyor
      }

      events.push({ tagId: bag.tagId, checkpoint: "sorting", delay: sorting, quiet: true, progress });

      if (misroutedBags.has(bag.tagId)) {
        events.push({
          tagId: bag.tagId,
          checkpoint: "loading",
          delay: loading,
          scannedFlightId: "TK7788",
          note: "MISROUTED simülasyonu",
          quiet: false,
          progress,
        });
        continue; // yanlış uçuşa giden bagaj burada akıştan çıkıyor (demo amaçlı)
      }

      events.push({ tagId: bag.tagId, checkpoint: "loading", delay: loading, quiet: true, progress });

      const arrivalUnload = landingBase + rand(0, 8000);
      events.push({ tagId: bag.tagId, checkpoint: "arrival-unload", delay: arrivalUnload, quiet: true, progress });

      let carousel;
      if (bag.passengerClass === "business" || bag.passengerClass === "first") {
        const target = bag.passengerClass === "business" ? 1300 : 800;
        const willMiss = Math.random() < 0.15; // gerçekçilik için %15 SLA kaçırma
        carousel = willMiss
          ? arrivalUnload + rand(target * 1.2, target * 2.2)
          : arrivalUnload + rand(target * 0.4, target * 0.9);
      } else {
        carousel = arrivalUnload + rand(3000, 15000);
      }
      events.push({ tagId: bag.tagId, checkpoint: "carousel", delay: carousel, quiet: true, progress });
    }

    progress.total = events.length;

    console.log(
      `[sensör] ${lostBags.size} kayıp bagaj, ${misroutedBags.size} yanlış-uçuş bagajı planlandı — akış birkaç dakika sürecek.\n`
    );

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