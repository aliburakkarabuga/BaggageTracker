// hcsr04-trigger.ino
//
// HC-SR04 ultrasonik mesafe sensöründen okuma yapar. Mesafe belirli bir
// eşiğin (TRIGGER_DISTANCE_CM) altına düştüğünde — yani önünden bir bagaj
// geçtiğinde — seri porta "TRIGGER\n" yazar. bridge.js bu mesajı dinleyip
// backend'e bir sensör event'i olarak iletir.
//
// Kablolama (test edildi):
//   HC-SR04 VCC  -> Arduino 5V
//   HC-SR04 GND  -> Arduino GND
//   HC-SR04 TRIG -> Arduino dijital pin 9
//   HC-SR04 ECHO -> Arduino dijital pin 10

const int TRIG_PIN = 9;
const int ECHO_PIN = 10;

// Bagaj bu mesafenin (cm) altına düşünce "geçti" sayılır.
const float TRIGGER_DISTANCE_CM = 15.0;

// Aynı geçişi birden fazla kez TRIGGER olarak göndermemek için, bir
// TRIGGER'dan sonra bu süre (ms) boyunca yeni tetikleme aranmaz.
const unsigned long COOLDOWN_MS = 2000;

unsigned long lastTriggerAt = 0;

float readDistanceCm() {
  // Trig pinini kısa bir süre HIGH yapıp ultrasonik darbe gönderiyoruz.
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Echo pini, sesin gidip gelme süresini mikrosaniye cinsinden döner.
  // 30000us timeout ~= 5 metre menzil, sensör aralığının epey üstünde.
  long durationMicros = pulseIn(ECHO_PIN, HIGH, 30000);

  if (durationMicros == 0) {
    // Yankı gelmedi (menzil dışı ya da okuma hatası) — büyük bir değer dön.
    return 999.0;
  }

  // Ses hızı ~343 m/s -> 0.0343 cm/us. Gidiş-dönüş olduğu için 2'ye böl.
  return (durationMicros * 0.0343) / 2.0;
}

void setup() {
  Serial.begin(9600);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

void loop() {
  float distanceCm = readDistanceCm();
  unsigned long now = millis();

  bool cooldownPassed = (now - lastTriggerAt) > COOLDOWN_MS;

  if (distanceCm < TRIGGER_DISTANCE_CM && cooldownPassed) {
    Serial.println("TRIGGER");
    lastTriggerAt = now;
  }

  delay(100); // saniyede ~10 ölçüm yeterli, gereksiz yere hızlı okumaya gerek yok
}
