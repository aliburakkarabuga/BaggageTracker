# API Referansı — Bagaj Takip Partner API

Bu doküman, havayolu şirketinin kendi backend sistemlerinin Bagaj Takip
sistemiyle entegrasyonu için gerekli tüm endpoint'leri tanımlar.

## Kimlik Doğrulama

Partner API, tüm `/api/*` endpoint'lerinde `x-api-key` header'ı ile makine-
makine kimlik doğrulaması kullanır. Bu, operasyon panelindeki insan
girişinden (kullanıcı adı/şifre) tamamen ayrı bir katmandır — panel girişi
sadece `/dashboard.html` sayfasını korur, partner API'yi etkilemez.

```
x-api-key: demo-havayolu-key-123
```

Demo ortamında sabit bir key kullanılmaktadır. Üretim entegrasyonunda her
havayolu ortağına ayrı, döndürülebilir bir key tahsis edilecektir.

Geçersiz veya eksik `x-api-key` ile yapılan her istek `401 Unauthorized`
döner.

---

## Endpoint'ler

### `POST /api/sensor-event`

Bir bagajın yeni bir checkpoint'e ulaştığını bildirir. Sistemin tek sensör
giriş noktasıdır — gerçek RFID/NFC/UHF okuyucular da simülatör de aynı bu
endpoint'i çağırır.

**Header'lar**
```
Content-Type: application/json
x-api-key: demo-havayolu-key-123
```

**Body**
```json
{
  "tagId": "TAG-2202",
  "checkpoint": "sorting",
  "scannedFlightId": "TK1982"
}
```

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `tagId` | string | evet | Bagaj etiket kimliği |
| `checkpoint` | string | evet | `check-in`, `sorting`, `loading`, `arrival-unload`, `carousel` |
| `scannedFlightId` | string | hayır | Sadece `loading` checkpoint'inde anlamlı — bagajın fiilen okutulduğu uçuş. Atanmış uçuştan farklıysa `MISROUTED` kritik alarmı tetiklenir |

**Başarılı yanıt — `200 OK`**
```json
{
  "tagId": "TAG-2202",
  "passenger": "S. Demir",
  "flightId": "TK1982",
  "passengerClass": "business",
  "checkpoint": "sorting",
  "priority": true,
  "alerts": [
    { "type": "SORT_COMMAND", "severity": "info", "message": "...", "timestamp": "2026-08-10T18:36:01.751Z" }
  ],
  "history": [
    { "checkpoint": "sorting", "timestamp": "2026-08-10T18:36:01.751Z" }
  ]
}
```

**Hata yanıtları**
- `400 Bad Request` — geçersiz `checkpoint` değeri
- `401 Unauthorized` — eksik/geçersiz `x-api-key`
- `404 Not Found` — sistemde kayıtlı olmayan `tagId`

---

### `GET /api/bags`

Sistemde kayıtlı tüm bagajların güncel durumunu döner.

**Header'lar:** `x-api-key: demo-havayolu-key-123`

**Yanıt — `200 OK`**
```json
[
  { "tagId": "TAG-2201", "passenger": "A. Kaya", "flightId": "TK1982", "passengerClass": "economy", "checkpoint": null, "priority": false, "alerts": [], "history": [] },
  { "tagId": "TAG-2202", "passenger": "S. Demir", "...": "..." }
]
```

---

### `POST /api/bags/:tagId/flag`

Bir bagajı manuel olarak incelemeye alır, `MANUAL_FLAG` (kritik) alarmı
ekler. Operasyon panelindeki "incelemeye al" butonu bu endpoint'i kullanır.

**Header'lar:** `Content-Type: application/json`, `x-api-key: ...`

**Body**
```json
{ "note": "Yolcu bagajın hasarlı göründüğünü bildirdi." }
```

**Yanıt:** güncellenmiş bagaj objesi (bkz. `/api/sensor-event` yanıt şeması)

**Hata:** `404 Not Found` — kayıtlı olmayan `tagId`

---

### `POST /api/reset`

Tüm bagajları temiz duruma döndürür (checkpoint: `null`, alerts: `[]`,
history: `[]`). Genelde bir demo/sunumdan önce çağrılır.

**Header'lar:** `x-api-key: ...`

**Yanıt — `200 OK`**
```json
{ "ok": true }
```

Ayrıca tüm bağlı WebSocket istemcilerine `{ "type": "reset" }` mesajı
yayınlanır.

---

### `POST /api/webhooks`

Havayolunun kendi backend'inin, her yeni alarmda push bildirimi alacağı bir
URL kaydeder (bkz. Webhook Mekanizması).

**Header'lar:** `Content-Type: application/json`, `x-api-key: ...`

**Body**
```json
{ "url": "https://havayolu-backend.example.com/bagaj-alarmlari" }
```

**Yanıt — `200 OK`**
```json
{ "ok": true, "registered": 1 }
```

---

## WebSocket — Canlı Güncellemeler

Operasyon paneli ve yolcu ekranları, aynı HTTP sunucusu üzerinden açılan bir
WebSocket bağlantısıyla anlık güncellemeleri alır (`ws://.../` veya
`wss://.../`).

**Mesaj tipleri**

Bir bagaj güncellendiğinde:
```json
{ "type": "event", "bag": { "tagId": "TAG-2202", "checkpoint": "sorting", "...": "..." } }
```

Sistem sıfırlandığında:
```json
{ "type": "reset" }
```

---

## Webhook Mekanizması

Havayolunun kendi backend'i, `/api/webhooks` ile bir URL kaydettirdiğinde,
sistemde her yeni alarm (`SORT_COMMAND`, `PRIORITY_LANE`, `MISROUTED`,
`SLA_MET`, `SLA_MISSED`, `MANUAL_FLAG`) üretildiğinde o URL'e otomatik
`POST` isteği gönderilir:

```json
{
  "tagId": "TAG-2204",
  "alert": { "type": "MISROUTED", "severity": "critical", "message": "...", "timestamp": "..." },
  "bag": { "tagId": "TAG-2204", "...": "..." }
}
```

Bu sayede havayolu, kendi operasyon sistemlerini bizim panelimizi açık
tutmadan da alarmlardan haberdar edebilir.

---

## Alarm Tipleri Referansı

| Tip | Severity | Ne zaman tetiklenir |
|---|---|---|
| `SORT_COMMAND` | info | Öncelikli (business/first) bagaj `sorting` checkpoint'ine ulaştığında |
| `PRIORITY_LANE` | info | Öncelikli bagaj `arrival-unload` checkpoint'ine ulaştığında |
| `SLA_MET` | info | Öncelikli bagaj, sınıfına özel hedef süre içinde banda ulaştığında |
| `SLA_MISSED` | warning | Öncelikli bagaj hedef süreyi kaçırdığında |
| `MISROUTED` | critical | `loading` checkpoint'inde okutulan uçuş, bagajın atanmış uçuşundan farklı olduğunda |
| `MANUAL_FLAG` | critical | Bir operatör bagajı manuel olarak incelemeye aldığında |
