// Limitador de abuso por IP, en memoria (sin coste de Firestore por petición).
// =============================================================================
// Ventana deslizante simple: más de MAX peticiones dentro de WINDOW_MS bloquea
// esa IP durante BLOCK_MS. Pensado para endpoints públicos baratos (galería):
// el uso humano normal jamás se acerca al umbral, solo frena scripts.
//
// Limitación conocida y asumida: en serverless (Vercel) el mapa vive por
// instancia, así que el contador no es global ni sobrevive a cold starts. Como
// elemento disuasorio es suficiente; el coste real por petición es ínfimo.
// =============================================================================

const WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const MAX_REQUESTS = 300; // por ventana e IP
const BLOCK_MS = 60 * 60 * 1000; // 1 hora de bloqueo
const MAX_TRACKED_IPS = 10_000; // tope de memoria

interface Bucket {
  count: number;
  windowStart: number;
  blockedUntil: number;
}

const buckets = new Map<string, Bucket>();

export function checkIpThrottle(ip: string): { ok: boolean } {
  const now = Date.now();

  // Poda perezosa para no crecer sin límite.
  if (buckets.size > MAX_TRACKED_IPS) {
    for (const [key, b] of buckets) {
      if (b.blockedUntil < now && now - b.windowStart > WINDOW_MS) buckets.delete(key);
    }
  }

  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = { count: 0, windowStart: now, blockedUntil: 0 };
    buckets.set(ip, bucket);
  }

  if (bucket.blockedUntil > now) return { ok: false };

  if (now - bucket.windowStart > WINDOW_MS) {
    bucket.windowStart = now;
    bucket.count = 0;
  }

  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    bucket.blockedUntil = now + BLOCK_MS;
    return { ok: false };
  }
  return { ok: true };
}
