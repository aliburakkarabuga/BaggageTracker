#  Bagaj Takip Sistemi

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-ws-4A90D9)
![Status](https://img.shields.io/badge/status-MVP%20demo-yellow)

Havalimanlarında **doğrulanabilir bagaj önceliklendirme ve takibi** — büyük
havayolu firmalarına pitch edilmek üzere geliştirilen bir konsept ürün.

## Neden?

Havayollarında "priority bagaj" diye bir hizmet zaten var: check-in'de
renkli bir etiket yapıştırılıyor ve yer hizmetleri personelinin bagajı önce
yerleştirmesi **umuluyor**. Bunun doğrulanabilir hiçbir tarafı yok — ne
yolcu ne de havayolu, hizmetin gerçekten verilip verilmediğini bilmiyor.

Bu projenin değeri: aynı hizmeti insan hafızasından çıkarıp
**makineleştirmek**. Her bagaj sensörle takip ediliyor, önceliklendirme
otomatik tetikleniyor, sonuç (hedefi tuttu mu, kaçırdı mı) ölçülüp
raporlanıyor — ve sistem sadece başarıları değil **başarısızlıkları da**
gösteriyor. Dürüst raporlama, havayoluna güven argümanı.

Gerçek havayolları zaten IATA Resolution 753 gereği bagaj takibi yapıyor,
genelde UHF RFID (860–960MHz, birkaç metre menzil) ile. Bu demo, ucuz ve
erişilebilir olduğu için NFC (13.56MHz, ~4cm) kullanıyor; gerçek üründe UHF
RFID'ye geçilecek. Mimarinin temel ilkesi: tek bir sensör giriş noktası
(`POST /api/sensor-event`) var — gerçek donanım geldiğinde backend/arayüz
kodu hiç değişmeden, sadece bu endpoint'e POST atan bir okuyucu eklenmesi
yeterli.

## Ekran Görüntüleri

<!--
Kendi ekran görüntülerini ekleyip aşağıdaki yorumdan çıkar:

![Operasyon Paneli](docs/screenshot-dashboard.png)
![Yolcu Ekranı](docs/screenshot-passenger.png)
![Mobil Demo](docs/screenshot-mobile.png)
-->

## Klasör Yapısı

```
server.js                    -> Backend (Express + WebSocket)
sensor-simulator.js          -> Sahte sensör event üreticisi (6 senaryo)
package.json
.gitignore
API-REFERANS.md              -> Partner API dokümanı
README.md
public/
  login.html                 -> Ops giriş ekranı
  dashboard.html              -> Ops paneli (canlı takip)
  passenger.html               -> Yolcu bagaj takip ekranı
  mobil-uygulama-demo.html      -> Mobil entegrasyon konsepti (nötr tema)
  mobil-uygulama-demo-thy.html  -> Mobil entegrasyon konsepti (havayolu teması)
hardware/
  bridge.js                  -> Arduino <-> backend köprüsü
  package.json
  hcsr04-trigger/
    hcsr04-trigger.ino       -> HC-SR04 Arduino kodu
data/                        -> Runtime state (git'e girmez)
```

## Kurulum ve Çalıştırma

```bash
npm install
npm start
```

Sunucu `http://localhost:3000` üzerinde ayağa kalkar.

- Ops paneli: `http://localhost:3000/login.html` (kullanıcı adı `operasyon`, şifre `demo1234`)
- Yolcu ekranı: `http://localhost:3000/passenger.html` (giriş gerektirmez)
- Mobil demo: `http://localhost:3000/mobil-uygulama-demo-thy.html`

### Sensör simülatörü

Backend ayaktayken, ayrı bir terminalde:

```bash
node sensor-simulator.js normal        # sorunsuz akış, SLA tutturuluyor
node sensor-simulator.js anomaly       # yanlış uçuşa okutulan bagaj (MISROUTED)
node sensor-simulator.js missed-sla    # dürüst raporlama: bir bagaj SLA'yı kaçırıyor
node sensor-simulator.js multi-flight  # iki uçuş paralel akıyor
node sensor-simulator.js edge-cases    # tekrar okuma / kayıtsız etiket / checkpoint atlama / kayıp bagaj
node sensor-simulator.js stress        # kısa sürede yoğun trafik
node sensor-simulator.js realistic-100 # ~100 yolcu, gerçek bir uçuş gibi (birkaç dakika sürer)
```

Temiz başlamak için:
```bash
curl -X POST http://localhost:3000/api/reset -H "x-api-key: demo-havayolu-key-123"
```

## Donanım Durumu

-  HC-SR04 ultrasonik mesafe sensörü Arduino ile test edildi, `bridge.js`
  üzerinden backend'e canlı event gönderiyor.
-  RC522 (NFC/RFID okuyucu) ile gerçek etiket kimlikleri kullanan bir
  versiyona geçiş planlanıyor.

Donanım kurulumu için `hardware/` klasörüne bakın.

## Henüz Yapılmayanlar

- Kalıcı bir veritabanı (şu an basit JSON dosyası, `data/bags-state.json`)
- Gerçek IATA/PADIS mesaj formatı uyumu
- Gerçek RFID donanımıyla uçtan uca test
- Üretim seviyesinde partner key yönetimi (şu an tek sabit demo key)