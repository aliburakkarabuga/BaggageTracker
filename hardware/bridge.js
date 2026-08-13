// bridge.js
//
// Arduino'dan (hcsr04-trigger.ino) gelen "TRIGGER" mesajlarını seri porttan
// dinler, her tetiklemede backend'e gerçek bir sensör event'i olarak POST
// atar. Gerçek RFID/NFC okuyucu geldiğinde, backend'de HİÇBİR şey
// değişmeden bu dosyanın yerine benzer bir köprü (ya da doğrudan okuyucunun
// kendi entegrasyonu) geçebilir — mimarinin temel ilkesi bu.
//
// Çalıştırma:
//   SERIAL_PATH=/dev/tty.usbserial-XXX npm start
//
// Port ismini bulmak için: ls /dev/tty.*  (Mac'te genelde "usbserial-..."
// ile başlar, cihaza göre değişir.
//
// İsteğe bağlı ortam değişkenleri:
//   API_URL     -> varsayılan http://localhost:3000/api/sensor-event
//   API_KEY     -> varsayılan demo-havayolu-key-123
//   TAG_ID      -> bu okuyucu hangi bagaj etiketini temsil ediyor (varsayılan TAG-2201)
//   CHECKPOINT  -> bu okuyucu hangi checkpoint'i temsil ediyor (varsayılan check-in)

const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const SERIAL_PATH = process.env.SERIAL_PATH;
const BAUD_RATE = Number(process.env.BAUD_RATE || 9600);
const API_URL = process.env.API_URL || "http://localhost:3000/api/sensor-event";
const API_KEY = process.env.API_KEY || "demo-havayolu-key-123";
const TAG_ID = process.env.TAG_ID || "TAG-2201";
const CHECKPOINT = process.env.CHECKPOINT || "check-in";

if (!SERIAL_PATH) {
  console.error("[bridge] SERIAL_PATH ortam değişkeni gerekli.");
  console.error("[bridge] Örnek: SERIAL_PATH=/dev/tty.usbserial-110 npm start");
  console.error("[bridge] Port ismini bulmak için terminalde: ls /dev/tty.*");
  process.exit(1);
}

async function sendSensorEvent() {
  console.log(`[bridge] TRIGGER algılandı -> ${TAG_ID} / ${CHECKPOINT} gönderiliyor...`);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ tagId: TAG_ID, checkpoint: CHECKPOINT }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[bridge]   -> HTTP ${res.status}: ${body.error || JSON.stringify(body)}`);
    } else {
      console.log(`[bridge]   -> backend güncellendi, checkpoint: ${body.checkpoint}`);
    }
  } catch (err) {
    console.error(`[bridge]   -> istek başarısız: ${err.message} (backend çalışıyor mu? npm start ile ayrı bir terminalde başlattın mı?)`);
  }
}

console.log(`[bridge] Seri port açılıyor: ${SERIAL_PATH} @ ${BAUD_RATE} baud`);

const port = new SerialPort({ path: SERIAL_PATH, baudRate: BAUD_RATE }, (err) => {
  if (err) {
    console.error(`[bridge] Seri port açılamadı: ${err.message}`);
    console.error("[bridge] Kontrol et: doğru port mu seçildi (ls /dev/tty.*)? Arduino IDE'nin Serial Monitor'ü açık mı (açıksa kapat, aynı anda ikisi porta erişemez)?");
    process.exit(1);
  }
});

const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

port.on("open", () => {
  console.log("[bridge] Seri port açıldı, Arduino'dan TRIGGER mesajları bekleniyor...");
});

parser.on("data", (line) => {
  const trimmed = line.trim();
  if (trimmed === "TRIGGER") {
    sendSensorEvent();
  } else if (trimmed) {
    console.log(`[bridge] (bilinmeyen seri mesaj, yok sayıldı): ${trimmed}`);
  }
});

port.on("error", (err) => {
  console.error(`[bridge] Seri port hatası: ${err.message}`);
});
