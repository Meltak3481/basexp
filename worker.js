/**
 * Cloudflare Worker — BaseCore x402 Payment Gateway (DÜZELTILMIŞ)
 * CDP Ed25519 JWT Authentication + İki Aşamalı Verify/Settle Akışı
 *
 * ═══════════════════════════════════════════════════════════════════
 * ÖNCEKİ HATALARIN ÖZETİ:
 * ─────────────────────────────────────────────────────────────────
 * 1. /facilitate endpoint MEVCUT DEĞİL → /verify + /settle ayrı ayrı
 * 2. Basic Auth ÇALIŞMAZ → Ed25519 JWT Bearer Token gerekli
 * 3. Tek adımlı akış YANLIŞ → Önce verify, sonra settle
 * 4. paymentPayload decode edilmiyordu → base64 → JSON parse gerekli
 * 5. 402 response formatı eksikti → PAYMENT-REQUIRED header gerekli
 * ═══════════════════════════════════════════════════════════════════
 *
 * Cloudflare Secrets (Wrangler / Dashboard):
 *   CDP_API_KEY    → CDP Key ID (UUID formatı, ör: "3336fde1-92c9-4d55-...")
 *   CDP_KEY_SECRET → CDP Ed25519 Private Key (base64 encoded, ~88 karakter)
 *   FEE_WALLET     → Ödeme alacak cüzdan adresi (0x...)
 *
 * NOT: CDP_API_SECRET ismi de desteklenir (fallback), ama Cloudflare'de
 *      CDP_KEY_SECRET olarak tanımlıysan sorun yok.
 */

// ── SABİTLER ──
const CDP_BASE_URL  = 'https://api.cdp.coinbase.com/platform/v2/x402';
const CDP_VERIFY    = CDP_BASE_URL + '/verify';
const CDP_SETTLE    = CDP_BASE_URL + '/settle';
const USDC_BASE     = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK       = 'base';          // CDP kısa format: "base"
const NETWORK_CAIP2 = 'eip155:8453';   // Client tarafında kullanılan CAIP-2 formatı
const PRICE_ATOMIC  = '50000';         // 0.05 USDC (6 decimals)
const TIMEOUT_SEC   = 300;

// ── BASEXP AKSİYON TANIMLARI ──
const ACTIONS = {
  special_food:  { xp: 500, needs: { hunger: 30, water: 10, happy: 10, energy: 10 }, desc: 'Özel yemek' },
  costume:       { xp: 200, needs: {},                                                desc: 'Kostüm'     },
  xp_boost:      { xp:   0, needs: {},                                                desc: 'XP Boost'   },
  energy_drink:  { xp: 300, needs: { energy: 100 },                                  desc: 'Enerji içeceği' },
  lucky_box:     { xp: null, needs: {},                                               desc: 'Şans kutusu' },
  wake_up:       { xp: 150, needs: { energy: 50 },                                   desc: 'Uyandırma'  },
};
const LUCKY_BOX_MIN = 100;
const LUCKY_BOX_MAX = 2000;
const KV_TTL = 60 * 60 * 24 * 90; // 90 gün

// ── CORS HEADER'LARI ──
// BaseCore + BaseXP + local desteklenir
const ALLOWED_ORIGINS = [
  'https://basecore.fun',
  'https://www.basecore.fun',
  'https://basexp.xyz',
  'https://www.basexp.xyz',
  'http://localhost:5500',
  'http://localhost:5501',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://localhost:8787',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5501',
  'http://127.0.0.1:3000',
];

function getCorsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0]; // default: production
  return {
    'Access-Control-Allow-Origin':   origin,
    'Access-Control-Allow-Methods':  'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':  'Content-Type, X-PAYMENT, X-Payment, x-payment, PAYMENT-SIGNATURE, Authorization',
    'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE',
    'Vary': 'Origin',
  };
}

// ═══════════════════════════════════════════════════════════════════
// ── YARDIMCI FONKSİYONLAR ──
// ═══════════════════════════════════════════════════════════════════

function jsonRes(status, body, extraHeaders = {}, requestOrigin = '*') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(requestOrigin), 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/** Base64URL encode (padding'siz, URL-safe) */
function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Standard base64 decode */
function base64Decode(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ═══════════════════════════════════════════════════════════════════
// ── CDP Ed25519 JWT TOKEN OLUŞTURMA ──
// ═══════════════════════════════════════════════════════════════════
/**
 * CDP API için Ed25519 (EdDSA) imzalı JWT oluşturur.
 * Cloudflare Workers Web Crypto API ile Ed25519 destekler.
 *
 * JWT Format:
 *   Header: { alg: "EdDSA", typ: "JWT", kid: keyName, nonce: random }
 *   Payload: { sub: keyName, iss: "cdp", aud: ["cdp_service"],
 *              nbf: now, exp: now+120, uri: "POST api.cdp.coinbase.com/platform/v2/x402/..." }
 */
async function buildCdpJwt(keyName, keySecretB64, httpMethod, requestPath) {
  // 1. Base64'ten Ed25519 private key'i decode et
  const decoded = base64Decode(keySecretB64);

  // Ed25519 key boyut kontrolü
  // CDP'nin verdiği key: 64 byte (32 seed + 32 public) veya 32 byte (sadece seed)
  let seed;
  if (decoded.length === 64) {
    seed = decoded.slice(0, 32);
  } else if (decoded.length === 32) {
    seed = decoded;
  } else {
    throw new Error(`Geçersiz Ed25519 key uzunluğu: ${decoded.length} byte`);
  }

  // 2. Web Crypto API için PKCS8 formatına çevir
  // Web Crypto'da Ed25519 private key SADECE 'pkcs8' formatında import edilebilir.
  // 'raw' + ['sign'] → "invalid usage" hatasına yol açar.
  //
  // PKCS8 Ed25519 private key yapısı:
  //   30 2e          → SEQUENCE (46 byte)
  //   02 01 00       → INTEGER 0 (version)
  //   30 05          → SEQUENCE (5 byte) — AlgorithmIdentifier
  //     06 03 2b 65 70  → OID 1.3.101.112 (Ed25519)
  //   04 22          → OCTET STRING (34 byte)
  //     04 20        → OCTET STRING (32 byte) — inner seed wrapper
  //       [32 byte seed]
  const pkcs8Header = new Uint8Array([
    0x30, 0x2e,             // SEQUENCE
    0x02, 0x01, 0x00,       // version: 0
    0x30, 0x05,             // AlgorithmIdentifier SEQUENCE
      0x06, 0x03, 0x2b, 0x65, 0x70, // OID Ed25519
    0x04, 0x22,             // privateKey OCTET STRING
      0x04, 0x20,           // inner OCTET STRING (seed)
  ]);

  const pkcs8Key = new Uint8Array(pkcs8Header.length + seed.length);
  pkcs8Key.set(pkcs8Header);
  pkcs8Key.set(seed, pkcs8Header.length);

  // 3. PKCS8 formatında import et
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Key,
    { name: 'Ed25519' },
    false,
    ['sign']
  );

  // 3. Nonce oluştur
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // 4. JWT Header
  const header = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid: keyName,
    nonce: nonce,
  };

  // 5. JWT Payload
  const now = Math.floor(Date.now() / 1000);
  const uri = `${httpMethod} api.cdp.coinbase.com${requestPath}`;

  const payload = {
    sub: keyName,
    iss: 'cdp',
    aud: ['cdp_service'],
    nbf: now,
    exp: now + 120, // 2 dakika geçerli
    uri: uri,
  };

  // 6. Encode & Sign
  const encodedHeader  = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const message        = `${encodedHeader}.${encodedPayload}`;

  const signatureBuffer = await crypto.subtle.sign(
    { name: 'Ed25519' },
    cryptoKey,
    new TextEncoder().encode(message)
  );

  const encodedSignature = base64url(signatureBuffer);

  return `${message}.${encodedSignature}`;
}

// ═══════════════════════════════════════════════════════════════════
// ── CDP'YE İSTEK GÖNDERİCİ ──
// ═══════════════════════════════════════════════════════════════════
async function cdpRequest(endpoint, body, keyName, keySecretB64) {
  const url  = new URL(endpoint);
  const path = url.pathname; // /platform/v2/x402/verify veya /settle

  const jwt = await buildCdpJwt(keyName, keySecretB64, 'POST', path);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

// ═══════════════════════════════════════════════════════════════════
// ── ANA WORKER ──
// ═══════════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {

    const origin = request.headers.get('Origin') || '';

    // ── CORS Preflight ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
    }

    // ── Konfigürasyon ──
    const payTo        = env.FEE_WALLET || '0x356473fc86c257B05f7CaCF5FB496C4Fd93FbF94';
    const cdpKeyName   = env.CDP_API_KEY;
    const cdpKeySecret = env.CDP_KEY_SECRET || env.CDP_API_SECRET;

    // NOT: CDP credential kontrolü artık SADECE ödeme rotalarında (/action ve /)
    // yapılıyor. Eski kodda burada global return vardı ve CDP ayarlı değilken
    // /health, /leaderboard, /kv/* gibi ödeme dışı rotaların hepsi 500 dönüyordu.

    const url  = new URL(request.url);
    const path = url.pathname;

    // ══════════════════════════════════════════════════════════════
    // GET /health — Sistem durumu
    // ══════════════════════════════════════════════════════════════
    if (request.method === 'GET' && path === '/health') {
      return jsonRes(200, {
        ok:       true,
        service:  'basecore-pay',
        cdpReady: !!(cdpKeyName && cdpKeySecret),
        kvReady:  !!env.BASEXP_KV,
        ts:       Date.now(),
      }, {}, origin);
    }

    // ══════════════════════════════════════════════════════════════
    // GET /fee-wallet — BaseXP client'ı buradan FEE_WALLET alır
    // ══════════════════════════════════════════════════════════════
    if (request.method === 'GET' && path === '/fee-wallet') {
      return jsonRes(200, { address: payTo }, {}, origin);
    }

    // ══════════════════════════════════════════════════════════════
    // POST /kv/save — BaseXP karakter state kaydet
    // ══════════════════════════════════════════════════════════════
    if (request.method === 'POST' && path === '/kv/save') {
      if (!env.BASEXP_KV) return jsonRes(503, { error: 'KV namespace bağlı değil' }, {}, origin);
      let body;
      try { body = await request.json(); } catch { return jsonRes(400, { error: 'Geçersiz JSON' }, {}, origin); }
      const { address, character } = body;
      if (!address || !character) return jsonRes(400, { error: 'address ve character gerekli' }, {}, origin);
      await env.BASEXP_KV.put(`char:${address.toLowerCase()}`, JSON.stringify(character), { expirationTtl: KV_TTL });
      return jsonRes(200, { success: true }, {}, origin);
    }

    // ══════════════════════════════════════════════════════════════
    // GET /kv/load?address=0x... — BaseXP karakter state yükle
    // ══════════════════════════════════════════════════════════════
    if (request.method === 'GET' && path === '/kv/load') {
      if (!env.BASEXP_KV) return jsonRes(503, { error: 'KV namespace bağlı değil' }, {}, origin);
      const address = url.searchParams.get('address');
      if (!address) return jsonRes(400, { error: 'address parametresi gerekli' }, {}, origin);
      const raw = await env.BASEXP_KV.get(`char:${address.toLowerCase()}`).catch(() => null);
      let character = null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          // Eski format { character, updatedAt } veya düz character — ikisini de destekle
          character = (parsed && typeof parsed === 'object' && 'character' in parsed)
            ? parsed.character
            : parsed;
        } catch { character = null; }
      }
      return jsonRes(200, { character }, {}, origin);
    }

    // ══════════════════════════════════════════════════════════════
    // GET /leaderboard — Top 100
    // ══════════════════════════════════════════════════════════════
    if (request.method === 'GET' && path === '/leaderboard') {
      if (!env.BASEXP_KV) return jsonRes(503, { error: 'KV namespace bağlı değil' }, {}, origin);
      const raw = await env.BASEXP_KV.get('leaderboard:top100').catch(() => null);
      return jsonRes(200, { leaderboard: raw ? JSON.parse(raw) : [] }, {}, origin);
    }

    // ══════════════════════════════════════════════════════════════
    // POST /leaderboard/update — Skor güncelle
    // ══════════════════════════════════════════════════════════════
    if (request.method === 'POST' && path === '/leaderboard/update') {
      if (!env.BASEXP_KV) return jsonRes(503, { error: 'KV namespace bağlı değil' }, {}, origin);
      let body;
      try { body = await request.json(); } catch { return jsonRes(400, { error: 'Geçersiz JSON' }, {}, origin); }
      const { address, level, totalXP, name } = body;
      if (!address) return jsonRes(400, { error: 'address gerekli' }, {}, origin);

      // ── Anti-cheat: gönderilen totalXP, sunucuda kayıtlı XP'yi aşamaz ──
      // Kaynak: /xp/update ile yazılan xp:<addr> veya char:<addr>.totalXP.
      // İkisi de yoksa entry kabul edilir ama gelen değer makul üst sınıra (cap) çekilir.
      let serverXP = null;
      const xpRaw = await env.BASEXP_KV.get(`xp:${address.toLowerCase()}`).catch(() => null);
      if (xpRaw) {
        try { serverXP = JSON.parse(xpRaw)?.xp ?? null; } catch {}
      }
      if (serverXP === null) {
        const charRaw = await env.BASEXP_KV.get(`char:${address.toLowerCase()}`).catch(() => null);
        if (charRaw) {
          try {
            const p = JSON.parse(charRaw);
            const c = (p && 'character' in p) ? p.character : p;
            serverXP = c?.totalXP ?? null;
          } catch {}
        }
      }
      const claimedXP = Number(totalXP) || 0;
      // Sunucu kaydı varsa onu tavan kabul et; yoksa claimed'ı geçir ama negatifi engelle
      const safeXP = serverXP !== null ? Math.min(claimedXP, serverXP) : Math.max(0, claimedXP);

      const raw   = await env.BASEXP_KV.get('leaderboard:top100').catch(() => null);
      let board   = raw ? JSON.parse(raw) : [];
      const idx   = board.findIndex(e => e.address.toLowerCase() === address.toLowerCase());
      const entry = {
        address:   address.toLowerCase(),
        shortAddr: address.slice(0, 6) + '…' + address.slice(-4),
        level:     level   || 1,
        totalXP:   safeXP,
        name:      String(name || 'Anonim').slice(0, 24),
        updatedAt: Date.now(),
      };
      if (idx >= 0) board[idx] = entry; else board.push(entry);
      board.sort((a, b) => b.totalXP - a.totalXP);
      board = board.slice(0, 100);
      await env.BASEXP_KV.put('leaderboard:top100', JSON.stringify(board), { expirationTtl: KV_TTL });
      const rank = board.findIndex(e => e.address.toLowerCase() === address.toLowerCase()) + 1;
      return jsonRes(200, { success: true, rank }, {}, origin);
    }

    // ══════════════════════════════════════════════════════════════
    // GET /xp/get?address=0x... — Cross-site XP oku (BaseCore ↔ BaseXP)
    // ══════════════════════════════════════════════════════════════
    if (request.method === 'GET' && path === '/xp/get') {
      if (!env.BASEXP_KV) return jsonRes(503, { error: 'KV namespace bağlı değil' }, {}, origin);
      const address = url.searchParams.get('address');
      if (!address) return jsonRes(400, { error: 'address parametresi gerekli' }, {}, origin);
      const raw = await env.BASEXP_KV.get(`xp:${address.toLowerCase()}`).catch(() => null);
      let data = { xp: 0, level: 1, streak: 0 };
      if (raw) { try { data = { ...data, ...JSON.parse(raw) }; } catch {} }
      return jsonRes(200, data, {}, origin);
    }

    // ══════════════════════════════════════════════════════════════
    // POST /xp/update — Cross-site XP yaz (monotonik: sadece artar)
    // body: { address, xp, level, streak, refs, tasks, source }
    // ══════════════════════════════════════════════════════════════
    if (request.method === 'POST' && path === '/xp/update') {
      if (!env.BASEXP_KV) return jsonRes(503, { error: 'KV namespace bağlı değil' }, {}, origin);
      let body;
      try { body = await request.json(); } catch { return jsonRes(400, { error: 'Geçersiz JSON' }, {}, origin); }
      const { address, xp, level, streak, source } = body;
      if (!address) return jsonRes(400, { error: 'address gerekli' }, {}, origin);

      const key = `xp:${address.toLowerCase()}`;
      const prevRaw = await env.BASEXP_KV.get(key).catch(() => null);
      let prev = { xp: 0, level: 1, streak: 0 };
      if (prevRaw) { try { prev = { ...prev, ...JSON.parse(prevRaw) }; } catch {} }

      const incomingXP = Number(xp) || 0;
      // Monotonik: XP geriye gitmez (farklı cihaz/site eşitlemesinde veri kaybını önler)
      const merged = {
        xp:        Math.max(prev.xp, incomingXP),
        level:     Math.max(prev.level || 1, Number(level) || 1),
        streak:    Math.max(prev.streak || 0, Number(streak) || 0),
        source:    source || prev.source || 'unknown',
        updatedAt: Date.now(),
      };
      await env.BASEXP_KV.put(key, JSON.stringify(merged), { expirationTtl: KV_TTL });
      return jsonRes(200, { success: true, ...merged }, {}, origin);
    }

    // ══════════════════════════════════════════════════════════════
    // POST /referral — Referral kodu uygula (kullanıcı başına 1 kez)
    // body: { address, code }   code = davet edenin BXP-kodu
    // ══════════════════════════════════════════════════════════════
    if (request.method === 'POST' && path === '/referral') {
      if (!env.BASEXP_KV) return jsonRes(503, { error: 'KV namespace bağlı değil' }, {}, origin);
      let body;
      try { body = await request.json(); } catch { return jsonRes(400, { error: 'Geçersiz JSON' }, {}, origin); }
      const { address, code } = body;
      if (!address || !code) return jsonRes(400, { error: 'address ve code gerekli' }, {}, origin);

      const addr = address.toLowerCase();
      const refCode = String(code).trim().toUpperCase();

      // Kendi kodunu kullanma kontrolü (BXP + adresin 2-8. karakterleri)
      const ownCode = 'BXP' + address.slice(2, 8).toUpperCase();
      if (refCode === ownCode) {
        return jsonRes(400, { error: 'Kendi kodunu kullanamazsın', code: 'SELF_REF' }, {}, origin);
      }

      // Bu adres daha önce referral kullandı mı?
      const usedKey = `ref:used:${addr}`;
      const already = await env.BASEXP_KV.get(usedKey).catch(() => null);
      if (already) {
        return jsonRes(409, { error: 'Referral kodu zaten kullanıldı', code: 'ALREADY_USED' }, {}, origin);
      }

      // Kaydet: bu adres bu kodu kullandı
      await env.BASEXP_KV.put(usedKey, JSON.stringify({ code: refCode, ts: Date.now() }), { expirationTtl: KV_TTL });

      // Davet eden için sayaç artır (refCount:<code>)
      const cntKey = `ref:count:${refCode}`;
      const cntRaw = await env.BASEXP_KV.get(cntKey).catch(() => null);
      const count  = (cntRaw ? Number(cntRaw) : 0) + 1;
      await env.BASEXP_KV.put(cntKey, String(count), { expirationTtl: KV_TTL });

      return jsonRes(200, { success: true, applied: refCode, inviterTotal: count }, {}, origin);
    }

    // ══════════════════════════════════════════════════════════════
    // POST /action — BaseXP x402 ödemeli aksiyon
    // ══════════════════════════════════════════════════════════════
    if (request.method === 'POST' && path === '/action') {
      // Bu rota ödeme yapar → CDP credential şart
      if (!cdpKeyName || !cdpKeySecret) {
        return jsonRes(500, { error: 'Server misconfiguration: CDP credentials missing' }, {}, origin);
      }
      const actionPaymentHeader =
        request.headers.get('X-PAYMENT') ||
        request.headers.get('X-Payment') ||
        request.headers.get('x-payment') ||
        request.headers.get('PAYMENT-SIGNATURE') || null;

      if (!actionPaymentHeader) {
        const pr = {
          x402Version: 1, scheme: 'exact', network: NETWORK,
          maxAmountRequired: PRICE_ATOMIC, resource: '/action',
          description: 'BaseXP aksiyon ücreti — 0.05 USDC',
          mimeType: 'application/json', payTo,
          maxTimeoutSeconds: TIMEOUT_SEC, asset: USDC_BASE,
          extra: { name: 'USD Coin', version: '2', decimals: 6 },
        };
        return jsonRes(402, { x402Version: 1, accepts: [pr], error: 'Payment required' }, {
          'PAYMENT-REQUIRED': btoa(JSON.stringify({ x402Version: 1, accepts: [pr] })),
        }, origin);
      }

      let actionBody;
      try { actionBody = await request.json(); } catch { return jsonRes(400, { error: 'Geçersiz JSON body' }, {}, origin); }
      const { action, address: actionAddress, costumeId } = actionBody;

      if (!action || !ACTIONS[action]) {
        return jsonRes(400, { error: 'Geçersiz aksiyon', validActions: Object.keys(ACTIONS) }, {}, origin);
      }
      if (!actionAddress) return jsonRes(400, { error: 'address gerekli' }, {}, origin);

      // Ödemeyi işle
      let actionPayload;
      try {
        actionPayload = JSON.parse(atob(actionPaymentHeader));
      } catch { return jsonRes(400, { error: 'Geçersiz payment header' }, {}, origin); }
      if (actionPayload.network === NETWORK_CAIP2) actionPayload.network = NETWORK;

      const actionReqs = {
        scheme: 'exact', network: NETWORK, maxAmountRequired: PRICE_ATOMIC,
        resource: '/action', description: 'BaseXP platform fee',
        mimeType: 'application/json', payTo, maxTimeoutSeconds: TIMEOUT_SEC,
        asset: USDC_BASE, extra: { name: 'USD Coin', version: '2', decimals: 6 },
      };

      let verifyRes;
      try {
        verifyRes = await cdpRequest(CDP_VERIFY, { x402Version: 1, paymentPayload: actionPayload, paymentRequirements: actionReqs }, cdpKeyName, cdpKeySecret);
      } catch (e) { return jsonRes(502, { error: 'CDP verify hatası: ' + e.message }, {}, origin); }

      if (!verifyRes.ok || verifyRes.data?.isValid === false) {
        return jsonRes(402, { error: 'Ödeme doğrulaması başarısız', invalidReason: verifyRes.data?.invalidReason || null }, {}, origin);
      }

      let settleRes;
      try {
        settleRes = await cdpRequest(CDP_SETTLE, { x402Version: 1, paymentPayload: actionPayload, paymentRequirements: actionReqs }, cdpKeyName, cdpKeySecret);
      } catch (e) { return jsonRes(502, { error: 'CDP settle hatası: ' + e.message }, {}, origin); }

      if (!settleRes.ok || settleRes.data?.success === false) {
        return jsonRes(402, { error: 'Settlement başarısız', errorReason: settleRes.data?.errorReason || null }, {}, origin);
      }

      const txHash = settleRes.data?.transaction || settleRes.data?.txHash || settleRes.data?.result?.transaction || null;
      const payer  = settleRes.data?.payer || actionPayload?.payload?.authorization?.from || null;

      // ── Replay koruması: aynı txHash daha önce ödüllendirildiyse tekrar verme ──
      if (env.BASEXP_KV && txHash) {
        const seen = await env.BASEXP_KV.get(`tx:${txHash}`).catch(() => null);
        if (seen) {
          return jsonRes(409, { error: 'Bu işlem zaten kullanıldı', code: 'TX_ALREADY_USED', txHash }, {}, origin);
        }
      }

      const actionDef = ACTIONS[action];
      let xpReward    = actionDef.xp;
      let extraData   = {};

      if (action === 'lucky_box') {
        const seed = parseInt((txHash || '0x1').slice(2, 10), 16);
        xpReward = LUCKY_BOX_MIN + (seed % (LUCKY_BOX_MAX - LUCKY_BOX_MIN + 1));
        extraData.xpReward = xpReward;
      }
      if (action === 'costume' && costumeId) extraData.costume = costumeId;
      if (action === 'xp_boost') extraData.boostUntil = Date.now() + 24 * 3600 * 1000;

      if (env.BASEXP_KV && txHash) {
        await env.BASEXP_KV.put(`tx:${txHash}`, JSON.stringify({
          action, address: actionAddress.toLowerCase(), txHash, xpReward, needs: actionDef.needs, ts: Date.now(),
        }), { expirationTtl: KV_TTL }).catch(() => {});
      }

      const paymentResponse = btoa(JSON.stringify({
        x402Version: 1, scheme: 'exact', network: NETWORK,
        success: true, transaction: txHash, payer,
      }));

      return jsonRes(200, {
        success: true, action, xpReward: xpReward || 0,
        needsBonus: actionDef.needs, txHash, payer, network: NETWORK,
        basescan: txHash ? `https://basescan.org/tx/${txHash}` : null,
        ...extraData,
      }, { 'X-PAYMENT-RESPONSE': paymentResponse, 'PAYMENT-RESPONSE': paymentResponse }, origin);
    }

    // ══════════════════════════════════════════════════════════════
    // POST / (root) — BaseCore x402 ödeme akışı
    // ══════════════════════════════════════════════════════════════
    if (request.method !== 'POST' || path !== '/') {
      return jsonRes(404, {
        error: 'Endpoint bulunamadı',
        available: [
          'GET  /health',
          'GET  /fee-wallet',
          'POST /               (BaseCore — X-PAYMENT header gerekli)',
          'POST /action         (BaseXP   — X-PAYMENT header gerekli)',
          'POST /kv/save',
          'GET  /kv/load?address=',
          'GET  /xp/get?address=',
          'POST /xp/update',
          'POST /referral',
          'GET  /leaderboard',
          'POST /leaderboard/update',
        ],
      }, {}, origin);
    }

    // Root ödeme yapar → CDP credential şart
    if (!cdpKeyName || !cdpKeySecret) {
      return jsonRes(500, { error: 'Server misconfiguration: CDP credentials missing' }, {}, origin);
    }

    // ── Payment Requirements (x402 protokol standardı) ──
    const paymentRequirements = {
      scheme:            'exact',
      network:           NETWORK,
      maxAmountRequired: PRICE_ATOMIC,
      resource:          new URL(request.url).pathname,
      description:       'BaseCore platform access fee',
      mimeType:          'application/json',
      payTo:             payTo,
      maxTimeoutSeconds: TIMEOUT_SEC,
      asset:             USDC_BASE,
      extra: {
        name:     'USD Coin',
        version:  '2',
        decimals: 6,
      },
    };

    // ── X-PAYMENT / PAYMENT-SIGNATURE header'ını al ──
    const paymentHeader =
      request.headers.get('X-PAYMENT')          ||
      request.headers.get('X-Payment')          ||
      request.headers.get('x-payment')          ||
      request.headers.get('PAYMENT-SIGNATURE')  || null;

    // ═══════════════════════════════════════════════════════════════
    // ADIM 1: Ödeme header'ı yoksa → 402 Payment Required döndür
    // ═══════════════════════════════════════════════════════════════
    if (!paymentHeader) {
      // x402 standardına göre PAYMENT-REQUIRED header'ı da eklenmeli
      const paymentRequiredB64 = btoa(JSON.stringify({
        x402Version: 1,
        accepts: [paymentRequirements],
      }));

      return jsonRes(402, {
        x402Version: 1,
        accepts: [paymentRequirements],
        error: 'Payment required',
      }, {
        'PAYMENT-REQUIRED': paymentRequiredB64,
      }, origin);
    }

    // ═══════════════════════════════════════════════════════════════
    // ADIM 2: Payment header'ı decode et
    // ═══════════════════════════════════════════════════════════════
    let paymentPayload;
    try {
      const decoded = atob(paymentHeader);
      paymentPayload = JSON.parse(decoded);
    } catch (e) {
      console.error('[DECODE ERROR]', e.message);
      return jsonRes(400, {
        error: 'Geçersiz payment header — Base64 JSON decode başarısız',
        details: e.message,
      }, {}, origin);
    }

    // Client CAIP-2 formatında gönderiyorsa ("eip155:8453"), CDP'nin beklediği
    // kısa formata ("base") dönüştür
    if (paymentPayload.network === NETWORK_CAIP2) {
      paymentPayload.network = NETWORK;
    }

    // paymentRequirements'ın network'ünü de CDP formatına eşle
    const cdpPaymentRequirements = {
      ...paymentRequirements,
      network: NETWORK, // CDP "base" bekliyor, "eip155:8453" değil
    };

    console.log('[x402] Payment payload alındı:', JSON.stringify(paymentPayload).slice(0, 200));

    // ═══════════════════════════════════════════════════════════════
    // ADIM 3: CDP /verify — Ödemeyi doğrula (on-chain değil, imza kontrolü)
    // ═══════════════════════════════════════════════════════════════
    let verifyResult;
    try {
      verifyResult = await cdpRequest(CDP_VERIFY, {
        x402Version:         1,
        paymentPayload:      paymentPayload,
        paymentRequirements: cdpPaymentRequirements,
      }, cdpKeyName, cdpKeySecret);

      console.log('[CDP VERIFY]', verifyResult.status, JSON.stringify(verifyResult.data));
    } catch (e) {
      console.error('[VERIFY FETCH ERROR]', e.message);
      return jsonRes(502, {
        error:   'CDP verify isteği başarısız',
        details: e.message,
      }, {}, origin);
    }

    // Verify başarısız → 402 ile reddet
    if (!verifyResult.ok || verifyResult.data?.isValid === false) {
      return jsonRes(402, {
        error:               'Ödeme doğrulaması başarısız',
        verifyStatus:        verifyResult.status,
        invalidReason:       verifyResult.data?.invalidReason || null,
        facilitatorResponse: verifyResult.data,
      }, {}, origin);
    }

    // ═══════════════════════════════════════════════════════════════
    // ADIM 4: CDP /settle — On-chain settlement (transfer)
    // ═══════════════════════════════════════════════════════════════
    let settleResult;
    try {
      settleResult = await cdpRequest(CDP_SETTLE, {
        x402Version:         1,
        paymentPayload:      paymentPayload,
        paymentRequirements: cdpPaymentRequirements,
      }, cdpKeyName, cdpKeySecret);

      console.log('[CDP SETTLE]', settleResult.status, JSON.stringify(settleResult.data));
    } catch (e) {
      console.error('[SETTLE FETCH ERROR]', e.message);
      return jsonRes(502, {
        error:   'CDP settle isteği başarısız',
        details: e.message,
      }, {}, origin);
    }

    // Settle başarısız
    if (!settleResult.ok || settleResult.data?.success === false) {
      return jsonRes(402, {
        error:               'Ödeme settlement başarısız',
        settleStatus:        settleResult.status,
        errorReason:         settleResult.data?.errorReason || null,
        facilitatorResponse: settleResult.data,
      }, {}, origin);
    }

    // ═══════════════════════════════════════════════════════════════
    // ADIM 5: BAŞARILI — Resource'u döndür
    // ═══════════════════════════════════════════════════════════════
    const txHash =
      settleResult.data?.transaction ||
      settleResult.data?.txHash      ||
      settleResult.data?.result?.transaction || null;

    const payer =
      settleResult.data?.payer ||
      paymentPayload?.payload?.authorization?.from || null;

    const network =
      settleResult.data?.network || NETWORK;

    // x402 standardı: Başarılı yanıtta X-PAYMENT-RESPONSE header'ı
    const paymentResponse = btoa(JSON.stringify({
      x402Version: 1,
      scheme:      'exact',
      network:     network,
      success:     true,
      transaction: txHash,
      payer:       payer,
    }));

    return jsonRes(200, {
      success:  true,
      txHash:   txHash,
      payer:    payer,
      network:  network,
      basescan: txHash ? `https://basescan.org/tx/${txHash}` : null,
    }, {
      'X-PAYMENT-RESPONSE': paymentResponse,
      'PAYMENT-RESPONSE':   paymentResponse,
    }, origin);
  },
};
