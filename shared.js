/* ============================================================
   BaseXP — Crypto Tamagotchi | shared.js  v2.0
   Wallet · x402 Payments · Character · XP · Shop economy
   (BaseCore cross-site XP sync REMOVED — XP lives only on basexp.xyz)
   ============================================================ */
'use strict';

/* ════════════════════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════════════════════ */
const CONFIG = {
  CHAIN_ID:      8453,
  CHAIN_NAME:    'Base',
  RPC_URL:       'https://mainnet.base.org',
  EXPLORER:      'https://basescan.org',

  USDC_ADDRESS:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDC_DECIMALS: 6,

  PAYMENT_AMOUNT:         50000n,   // 0.05 USDC atomic
  PAYMENT_AMOUNT_DISPLAY: '0.05',

  get WORKER_URL() {
    return (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'http://localhost:8787'
      : 'https://basexp-pay.meltak34.workers.dev';
  },

  // Need decay — per DECAY_INTERVAL tick
  NEED_DECAY_RATE: 0.022,   // ~8/hour at 1s tick
  DECAY_INTERVAL:  1000,    // 1s — battery friendly

  LS_PREFIX:       'basexp_',
  KV_SYNC_INTERVAL: 60_000, // push character state to KV every 60s

  // Evolution ladder — coherent "crypto glow-up", tier-colored
  EVOLUTIONS: [
    { level: 1,   emoji: '🥚', name: 'Egg',       desc: 'A mysterious egg appears on Base.',       color: '#8ea0c9', tier: 'common' },
    { level: 5,   emoji: '🐣', name: 'Hatchling', desc: 'It hatched! GM, world 🌅',                color: '#2bd6ff', tier: 'common' },
    { level: 11,  emoji: '🐥', name: 'Chick',     desc: 'Tiny but curious — learning the ropes.',  color: '#2bd6ff', tier: 'common' },
    { level: 18,  emoji: '🐤', name: 'HODLer',    desc: 'Holding strong through every dip 💪',     color: '#2bff9e', tier: 'rare' },
    { level: 27,  emoji: '😎', name: 'Trader',    desc: 'Charts on charts on charts 📈',           color: '#2bff9e', tier: 'rare' },
    { level: 38,  emoji: '🤖', name: 'Builder',   desc: 'Shipping onchain, day and night 🛠️',      color: '#00ffea', tier: 'rare' },
    { level: 50,  emoji: '🧙', name: 'Wizard',    desc: 'Casting onchain spells 🪄',               color: '#b76bff', tier: 'epic' },
    { level: 63,  emoji: '🐳', name: 'Whale',     desc: 'Moves the market with a splash 🌊',       color: '#b76bff', tier: 'epic' },
    { level: 77,  emoji: '🚀', name: 'Degen',     desc: 'Full send, no fear 🌈',                   color: '#ffc94d', tier: 'legendary' },
    { level: 90,  emoji: '💎', name: 'Diamond',   desc: 'Hands of pure carbon 💠',                 color: '#ffc94d', tier: 'legendary' },
    { level: 100, emoji: '🌌', name: 'Satoshi',   desc: 'Ascended. The final form. 🛸',            color: '#ff4d97', tier: 'mythic' },
  ],

  DIALOGS: {
    hungry:  ["I'm starving! 🍔", 'My tummy is rumbling…', 'Feed me, fren? 😢'],
    thirsty: ["So thirsty! 💧", 'Water… water…', 'Just a sip, please 🥺'],
    sad:     ["Let's play together 😔", "Did you forget me today?", "Feeling kinda down…"],
    tired:   ["I'm exhausted ⚡", 'No energy left…', 'Need a little rest…'],
    happy:   ["I'm so happy! 🎉", 'Being with you rocks!', 'Best day ever!'],
    idle:    ['GM! 🌞', "What's poppin' on Base?", "Let's farm some XP!", 'WAGMI! 🚀',
              'Missed you, fren 💙', 'What are we playing today?', 'To the moon? 🌙'],
    gm:      ['GM fren! 🌅', 'Rise and grind! Today slaps.', 'GM GM GM! ☀️'],
    sleep:   ['Zzz… 😴', 'Sleeping…', 'Five more minutes…'],
  },

  // Daily login reward ladder (XP) — index = streak day (capped/looped)
  LOGIN_REWARDS: [40, 55, 70, 90, 120, 160, 250],
};

/* ════════════════════════════════════════════════════════════
   SHOP CATALOG — single source of truth for premium items
   Every premium action costs 0.05 USDC (x402). Maps to worker ACTIONS.
   ════════════════════════════════════════════════════════════ */
const SHOP = {
  // ── Consumables (instant effect) ──
  consumables: [
    { id: 'special_food', action: 'special_food', icon: '🍖', name: 'Feast Platter', desc: 'All needs +25 · +250 XP', xp: 250, badge: null },
    { id: 'energy_drink', action: 'energy_drink', icon: '⚡', name: 'Energy Drink',  desc: 'Energy to 100% · +120 XP', xp: 120, badge: null },
    { id: 'lucky_box',    action: 'lucky_box',    icon: '🎲', name: 'Lucky Box',     desc: 'Win 80–500 XP!',          xp: null, badge: 'LUCK', badgeClass: '' },
    { id: 'mega_box',     action: 'lucky_box',    icon: '🎁', name: 'Mega Box',      desc: 'Better odds · 150–800 XP', xp: null, badge: 'HOT', badgeClass: 'paid-badge--hot' },
    { id: 'wake_up',      action: 'wake_up',      icon: '☀️', name: 'Wake Up Call',  desc: 'Instantly wake · +80 XP',  xp: 80, badge: null },
  ],

  // ── Boosts (timed buffs) ──
  boosts: [
    { id: 'xp_boost',   action: 'xp_boost', icon: '🚀', name: '2x XP — 24h', desc: 'Double all XP for 24 hours', xp: 0, badge: '24H', badgeClass: '' },
    { id: 'xp_boost_3', action: 'xp_boost', icon: '🌠', name: '2x XP — 72h', desc: 'Double XP, triple the time', xp: 0, badge: 'BEST', badgeClass: 'paid-badge--mythic', hours: 72 },
    { id: 'freeze',     action: 'xp_boost', icon: '🧊', name: 'Need Freeze', desc: 'Needs stop decaying 24h',     xp: 60, badge: null, freeze: true },
  ],

  // ── Costumes / skins (cosmetic, persistent) ──
  costumes: [
    { id: 'cape',     action: 'costume', icon: '🦸', name: 'Hero Cape',     desc: 'Classic superhero drip',     xp: 80,  rarity: 'common' },
    { id: 'crown',    action: 'costume', icon: '👑', name: 'Golden Crown',  desc: 'Wear it like royalty',       xp: 100, rarity: 'rare' },
    { id: 'shades',   action: 'costume', icon: '🕶️', name: 'Cool Shades',   desc: 'Deal with it 😎',            xp: 80,  rarity: 'common' },
    { id: 'wizard',   action: 'costume', icon: '🎩', name: 'Wizard Hat',    desc: 'Cast on-chain spells',       xp: 100, rarity: 'rare' },
    { id: 'halo',     action: 'costume', icon: '😇', name: 'Angel Halo',    desc: 'Pure & radiant',             xp: 140, rarity: 'epic' },
    { id: 'devil',    action: 'costume', icon: '😈', name: 'Devil Horns',   desc: 'A little degen energy',      xp: 140, rarity: 'epic' },
    { id: 'rainbow',  action: 'costume', icon: '🌈', name: 'Rainbow Aura',  desc: 'Glowing prismatic shell',    xp: 140, rarity: 'epic' },
    { id: 'galaxy',   action: 'costume', icon: '🌌', name: 'Galaxy Skin',   desc: 'Cosmos in your shell',       xp: 200, rarity: 'legendary' },
    { id: 'diamond',  action: 'costume', icon: '💎', name: 'Diamond Shell', desc: 'Unbreakable flex',           xp: 200, rarity: 'legendary' },
    { id: 'flame',    action: 'costume', icon: '🔥', name: 'Flame Coat',    desc: 'Always on fire',             xp: 140, rarity: 'epic' },
  ],

  // ── Mini-game power-ups ──
  gameBoosts: [
    { id: 'extra_life',  action: 'energy_drink', icon: '❤️', name: 'Extra Lives',   desc: '+3 lives in Coin Catch',  xp: 60 },
    { id: 'slow_time',   action: 'energy_drink', icon: '⏳', name: 'Slow Motion',    desc: 'Slows the next game 30%', xp: 60 },
    { id: 'double_score',action: 'xp_boost',     icon: '✖️', name: '2x Game Score',  desc: 'Double XP from games 24h',xp: 0, badge: '2x' },
  ],

  // ── Mystery / surprise tier ──
  mystery: [
    { id: 'mystery_egg', action: 'lucky_box', icon: '🥚', name: 'Mystery Egg',   desc: '??? Could be anything',   xp: null, badge: 'MYSTERY', badgeClass: 'paid-badge--mythic' },
    { id: 'whale_chest', action: 'lucky_box', icon: '🐋', name: 'Whale Chest',   desc: 'Whale-tier surprise loot', xp: null, badge: 'RARE',   badgeClass: 'paid-badge--mythic' },
    { id: 'cosmic_gift', action: 'lucky_box', icon: '🪐', name: 'Cosmic Gift',   desc: 'A gift from Satoshi',     xp: null, badge: 'COSMIC', badgeClass: 'paid-badge--mythic' },
  ],

  rarityColor: {
    common:    '#8ea0c9',
    rare:      '#2bd6ff',
    epic:      '#b76bff',
    legendary: '#ffc94d',
  },

  find(id) {
    for (const cat of ['consumables','boosts','costumes','gameBoosts','mystery']) {
      const hit = this[cat].find(i => i.id === id);
      if (hit) return hit;
    }
    return null;
  },
};

/* ════════════════════════════════════════════════════════════
   APP STATE
   ════════════════════════════════════════════════════════════ */
const AppState = {
  wallet: { address: null, provider: null, signer: null, type: null, connected: false, usdcBalance: 0n },
  character: null,
  ui: { currentPage: 'index', decayTimer: null, kvSyncTimer: null, dialogTimer: null },
};

/* ════════════════════════════════════════════════════════════
   DEFAULT CHARACTER
   ════════════════════════════════════════════════════════════ */
function createDefaultCharacter(address) {
  return {
    owner: address,
    name: 'Satoshi Jr.',
    createdAt: Date.now(),
    lastSeen: Date.now(),
    needs: { hunger: 80, water: 80, happy: 80, energy: 80 },
    xp: 0, level: 1, xpToNext: 100, totalXP: 0,
    streak: 0, lastCheckIn: null, lastGM: null,
    costume: null, ownedCostumes: [], accessories: [],
    isSleeping: false, xpBoostUntil: null, freezeUntil: null,
    taps: 0, lastTapReset: null, tapsToday: 0,
    daily: { gm: false, feed: false, water: false, checkin: false, date: null },
    stats: { totalFeeds: 0, totalWaters: 0, totalPlays: 0, gamesPlayed: 0, friendsVisited: 0, usdcSpent: 0, purchases: 0 },
  };
}

/* ════════════════════════════════════════════════════════════
   LOCAL STORAGE
   ════════════════════════════════════════════════════════════ */
const LS = {
  key: (addr) => `${CONFIG.LS_PREFIX}char_${addr.toLowerCase()}`,
  save(char) { try { localStorage.setItem(this.key(char.owner), JSON.stringify(char)); } catch (e) { console.warn('[LS] save', e); } },
  load(addr) { try { const r = localStorage.getItem(this.key(addr)); return r ? JSON.parse(r) : null; } catch { return null; } },
  remove(addr) { localStorage.removeItem(this.key(addr)); },
  setSetting(k, v) { localStorage.setItem(`${CONFIG.LS_PREFIX}${k}`, JSON.stringify(v)); },
  getSetting(k, d = null) { try { const v = localStorage.getItem(`${CONFIG.LS_PREFIX}${k}`); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
};

/* ════════════════════════════════════════════════════════════
   KV SYNC (character state + leaderboard only — no BaseCore XP)
   ════════════════════════════════════════════════════════════ */
const KVSync = {
  async push(char) {
    if (!AppState.wallet.connected) return;
    try {
      await fetch(`${CONFIG.WORKER_URL}/kv/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: char.owner, character: char }),
      });
    } catch (e) { console.warn('[KV] push', e); }
  },
  async pull(address) {
    try {
      const res = await fetch(`${CONFIG.WORKER_URL}/kv/load?address=${address}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.character || null;
    } catch { return null; }
  },
  async pushLeaderboard(char) {
    if (!AppState.wallet.connected) return;
    try {
      await fetch(`${CONFIG.WORKER_URL}/leaderboard/update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: char.owner, level: char.level, totalXP: char.totalXP, name: char.name }),
      });
    } catch (e) { console.warn('[KV] lb', e); }
  },
};

/* ════════════════════════════════════════════════════════════
   WALLET
   ════════════════════════════════════════════════════════════ */
const Wallet = {
  get ethers() { return window.ethers; },

  async connect(type = 'metamask') {
    if (!window.ethers) { Toast.show('ethers.js not loaded!', 'error', '⚠️'); throw new Error('no ethers'); }
    let ethereum;
    if (type === 'metamask') {
      ethereum = window.ethereum?.providers ? window.ethereum.providers.find(p => p.isMetaMask) : window.ethereum;
      if (!ethereum?.isMetaMask) { Toast.show('MetaMask not found — please install it.', 'error', '🦊'); throw new Error('no mm'); }
    } else if (type === 'coinbase') {
      ethereum = window.ethereum?.providers ? window.ethereum.providers.find(p => p.isCoinbaseWallet) : window.ethereum;
      if (!ethereum?.isCoinbaseWallet) { Toast.show('Coinbase Wallet not found!', 'error', '💙'); throw new Error('no cb'); }
    }
    try {
      const provider = new this.ethers.BrowserProvider(ethereum);
      await provider.send('eth_requestAccounts', []);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== CONFIG.CHAIN_ID) await this._switchToBase(ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      Object.assign(AppState.wallet, { provider, signer, address, type, connected: true });
      LS.setSetting('last_wallet_type', type);
      LS.setSetting('last_address', address);
      await this.refreshUSDCBalance();
      await Character.loadOrCreate(address);
      this._startListeners(ethereum);
      EventBus.emit('wallet:connected', { address, type });
      Toast.show(`Connected · ${this.shortAddr(address)}`, 'success', '🔗');
      return address;
    } catch (err) {
      if (err.code === 4001) Toast.show('Connection rejected.', 'warning', '❌');
      else Toast.show('Connection error: ' + (err.message || ''), 'error', '⚠️');
      throw err;
    }
  },

  async _switchToBase(ethereum) {
    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + CONFIG.CHAIN_ID.toString(16) }] });
    } catch (e) {
      if (e.code === 4902) {
        await ethereum.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: '0x' + CONFIG.CHAIN_ID.toString(16), chainName: 'Base',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [CONFIG.RPC_URL], blockExplorerUrls: [CONFIG.EXPLORER],
        }]});
      } else throw e;
    }
  },

  disconnect() {
    Object.assign(AppState.wallet, { address: null, provider: null, signer: null, type: null, connected: false, usdcBalance: 0n });
    Character.stopDecay();
    AppState.character = null;
    EventBus.emit('wallet:disconnected');
    Toast.show('Wallet disconnected.', 'warning', '🔌');
  },

  async refreshUSDCBalance() {
    if (!AppState.wallet.connected) return 0n;
    try {
      const iface = new this.ethers.Interface(['function balanceOf(address) view returns (uint256)']);
      const c = new this.ethers.Contract(CONFIG.USDC_ADDRESS, iface, AppState.wallet.provider);
      const bal = await c.balanceOf(AppState.wallet.address);
      AppState.wallet.usdcBalance = bal;
      EventBus.emit('wallet:balance', { usdc: bal });
      return bal;
    } catch (e) { console.warn('[Wallet] balance', e); return 0n; }
  },

  shortAddr(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : '—'; },
  formatUSDC(amt) { return (Number(amt) / 1e6).toFixed(2); },

  _startListeners(ethereum) {
    ethereum.on('accountsChanged', (a) => { if (!a.length) this.disconnect(); else location.reload(); });
    ethereum.on('chainChanged', () => location.reload());
  },

  async autoReconnect() {
    const type = LS.getSetting('last_wallet_type');
    const address = LS.getSetting('last_address');
    if (!type || !address) return false;
    try {
      const eth = window.ethereum; if (!eth) return false;
      const accts = await eth.request({ method: 'eth_accounts' });
      if (!accts.length) return false;
      await this.connect(type); return true;
    } catch { return false; }
  },
};

/* ════════════════════════════════════════════════════════════
   x402 PAYMENT
   ════════════════════════════════════════════════════════════ */
const X402 = {
  _domain(chainId) { return { name: 'USD Coin', version: '2', chainId, verifyingContract: CONFIG.USDC_ADDRESS }; },
  _types: { TransferWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ]},
  _randomNonce() {
    const a = new Uint8Array(32); crypto.getRandomValues(a);
    return '0x' + Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  async pay(action, body = {}) {
    const wallet = AppState.wallet;
    if (!wallet.connected) { Toast.show('Wallet not connected!', 'error', '🔌'); throw new Error('no wallet'); }
    await Wallet.refreshUSDCBalance();
    if (wallet.usdcBalance < CONFIG.PAYMENT_AMOUNT) {
      Toast.show(`Need ${CONFIG.PAYMENT_AMOUNT_DISPLAY} USDC on Base`, 'error', '💸'); throw new Error('low balance');
    }
    const now = Math.floor(Date.now() / 1000);
    const nonce = this._randomNonce();
    let feeWallet;
    try {
      const fw = await fetch(`${CONFIG.WORKER_URL}/fee-wallet`);
      feeWallet = (await fw.json()).address;
    } catch { Toast.show('Cannot reach payment server.', 'error', '🌐'); throw new Error('no worker'); }

    const authorization = {
      from: wallet.address, to: feeWallet, value: CONFIG.PAYMENT_AMOUNT.toString(),
      validAfter: (now - 60).toString(), validBefore: (now + 300).toString(), nonce,
    };

    let signature;
    try {
      Toast.show('Awaiting signature…', 'warning', '✍️');
      signature = await wallet.signer.signTypedData(this._domain(CONFIG.CHAIN_ID), this._types, authorization);
    } catch (err) {
      if (err.code === 4001 || err.code === 'ACTION_REJECTED') Toast.show('Signature rejected.', 'warning', '❌');
      else Toast.show('Signature error.', 'error', '⚠️');
      throw err;
    }

    const payload = { x402Version: 1, scheme: 'exact', network: 'base', payload: { signature, authorization } };
    const encoded = btoa(JSON.stringify(payload));

    Toast.show('Processing payment…', 'warning', '⏳');
    let response;
    try {
      response = await fetch(`${CONFIG.WORKER_URL}/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PAYMENT': encoded },
        body: JSON.stringify({ action, ...body }),
      });
    } catch (e) { Toast.show('Network error.', 'error', '🌐'); throw e; }

    if (response.status === 402) {
      const e = await response.json().catch(() => ({}));
      Toast.show('Payment failed: ' + (e.error || 'unknown'), 'error', '💳'); throw new Error('402');
    }
    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      Toast.show('Server error: ' + (e.error || response.status), 'error', '🔥'); throw new Error('server');
    }
    const result = await response.json();
    Toast.show(`Payment confirmed! ✅`, 'success', '✅');
    await Wallet.refreshUSDCBalance();
    return result;
  },
};

/* ════════════════════════════════════════════════════════════
   XP SYSTEM
   ════════════════════════════════════════════════════════════ */
const XP = {
  xpRequired(level) { return Math.floor(2800 * Math.pow(1.10, level - 1)); },

  getEvolution(level) {
    let cur = CONFIG.EVOLUTIONS[0];
    for (const e of CONFIG.EVOLUTIONS) { if (level >= e.level) cur = e; else break; }
    return cur;
  },

  add(amount, reason = '') {
    const char = AppState.character; if (!char) return;
    const boosted = char.xpBoostUntil && Date.now() < char.xpBoostUntil;
    const finalXP = boosted ? amount * 2 : amount;
    char.xp += finalXP; char.totalXP += finalXP;

    let leveled = false;
    while (char.xp >= this.xpRequired(char.level)) {
      char.xp -= this.xpRequired(char.level); char.level++; leveled = true; this._onLevelUp(char.level);
    }
    char.xpToNext = this.xpRequired(char.level);
    LS.save(char);
    EventBus.emit('xp:gained', { amount: finalXP, reason, boosted, level: char.level });
    if (amount > 0) Toast.show(`+${finalXP} XP${boosted ? ' 🚀2x' : ''}${reason ? ' · ' + reason : ''}`, 'xp', '⭐');

  },

  _onLevelUp(newLevel) {
    const prev = this.getEvolution(newLevel - 1);
    const next = this.getEvolution(newLevel);
    const evolved = prev.emoji !== next.emoji;
    Toast.show(`Level ${newLevel}! ${evolved ? '🌟 EVOLVED!' : '🎉'}`, 'success', '🏆');
    Confetti.rain(evolved ? 140 : 70);
    Utils.vibrate(evolved ? [40, 30, 60, 30, 80] : [30, 20, 40]);
    if (evolved) setTimeout(() => Evolution.show(next), 700);
    EventBus.emit('character:levelup', { level: newLevel, evolved, evo: next });
  },
};

/* ════════════════════════════════════════════════════════════
   CHARACTER
   ════════════════════════════════════════════════════════════ */
const Character = {
  async loadOrCreate(address) {
    let char = LS.load(address);
    if (!char) char = await KVSync.pull(address);
    if (!char) { char = createDefaultCharacter(address); Toast.show('New companion hatched! 🥚', 'success', '✨'); }
    // migrate missing fields
    char.ownedCostumes = char.ownedCostumes || [];
    char.freezeUntil = char.freezeUntil || null;
    char.tapsToday = char.tapsToday || 0;
    char.stats = Object.assign({ totalFeeds: 0, totalWaters: 0, totalPlays: 0, gamesPlayed: 0, friendsVisited: 0, usdcSpent: 0, purchases: 0 }, char.stats || {});

    if (char.lastSeen) this._applyOfflineDecay(char);
    this._resetDailyIfNeeded(char);
    AppState.character = char;
    char.lastSeen = Date.now();
    LS.save(char);
    this.startDecay(); this._startKVSync(); this._scheduleDialog();
    KVSync.push(char);
    EventBus.emit('character:loaded', char);
    return char;
  },

  _applyOfflineDecay(char) {
    if (char.freezeUntil && Date.now() < char.freezeUntil) return;
    const elapsed = (Date.now() - char.lastSeen) / 1000;
    if (elapsed < 5) return;
    const perTick = CONFIG.NEED_DECAY_RATE;
    const ticks = elapsed; // 1s ticks
    const d = perTick * ticks;
    const cap = v => Math.max(0, Math.min(100, v));
    char.needs.hunger = cap(char.needs.hunger - d * 0.9);
    char.needs.water  = cap(char.needs.water  - d * 1.0);
    char.needs.happy  = cap(char.needs.happy  - d * 0.7);
    char.needs.energy = cap(char.needs.energy - d * 0.6);
    if (d > 5) Toast.show(`Away ${Math.round(elapsed/60)} min — your pet missed you 😢`, 'warning', '⏰');
  },

  _resetDailyIfNeeded(char) {
    const today = new Date().toISOString().split('T')[0];
    if (char.daily.date !== today) {
      char.daily = { gm: false, feed: false, water: false, checkin: false, date: today };
      char.tapsToday = 0;
    }
  },

  startDecay() {
    if (AppState.ui.decayTimer) clearInterval(AppState.ui.decayTimer);
    AppState.ui.decayTimer = setInterval(() => this._tick(), CONFIG.DECAY_INTERVAL);
  },
  stopDecay() { if (AppState.ui.decayTimer) { clearInterval(AppState.ui.decayTimer); AppState.ui.decayTimer = null; } },

  _tick() {
    const char = AppState.character; if (!char || char.isSleeping) return;
    if (char.freezeUntil && Date.now() < char.freezeUntil) { EventBus.emit('character:tick', char.needs); return; }
    const r = CONFIG.NEED_DECAY_RATE; const cap = v => Math.max(0, Math.min(100, v));
    char.needs.hunger = cap(char.needs.hunger - r * 0.9);
    char.needs.water  = cap(char.needs.water  - r * 1.0);
    char.needs.happy  = cap(char.needs.happy  - r * 0.7);
    char.needs.energy = cap(char.needs.energy - r * 0.6);
    this._checkCritical(char);
    EventBus.emit('character:tick', char.needs);
  },

  _criticalWarned: {},
  _checkCritical(char) {
    const now = Date.now();
    for (const [need, val] of Object.entries(char.needs)) {
      const key = `${need}_critical`;
      if (val <= 10 && (!this._criticalWarned[key] || now - this._criticalWarned[key] > 60_000)) {
        this._criticalWarned[key] = now;
        const icons = { hunger: '🍔', water: '💧', happy: '😊', energy: '⚡' };
        const names = { hunger: 'Hungry', water: 'Thirsty', happy: 'Unhappy', energy: 'Low energy' };
        Toast.show(`${names[need]}! ${icons[need]} Take care of me!`, 'error', icons[need]);
        EventBus.emit('character:critical', { need, value: val });
        PushNotif.send(`Your pet is ${names[need].toLowerCase()}! ${icons[need]}`, 'Tap to check in');
      }
      if (val > 20) delete this._criticalWarned[`${need}_critical`];
    }
  },

  _startKVSync() {
    if (AppState.ui.kvSyncTimer) clearInterval(AppState.ui.kvSyncTimer);
    AppState.ui.kvSyncTimer = setInterval(async () => {
      if (!AppState.character || !AppState.wallet.connected) return;
      await KVSync.push(AppState.character);
    }, CONFIG.KV_SYNC_INTERVAL);
  },

  _scheduleDialog() {
    if (AppState.ui.dialogTimer) clearTimeout(AppState.ui.dialogTimer);
    const delay = 8000 + Math.random() * 18000;
    AppState.ui.dialogTimer = setTimeout(() => {
      if (AppState.character) EventBus.emit('character:dialog', this._pickDialog());
      this._scheduleDialog();
    }, delay);
  },

  _pickDialog() {
    const c = AppState.character; if (!c) return '';
    if (c.isSleeping) return this._rand(CONFIG.DIALOGS.sleep);
    if (c.needs.hunger < 20) return this._rand(CONFIG.DIALOGS.hungry);
    if (c.needs.water  < 20) return this._rand(CONFIG.DIALOGS.thirsty);
    if (c.needs.happy  < 20) return this._rand(CONFIG.DIALOGS.sad);
    if (c.needs.energy < 20) return this._rand(CONFIG.DIALOGS.tired);
    return this._rand(CONFIG.DIALOGS.idle);
  },
  _rand(a) { return a[Math.floor(Math.random() * a.length)]; },

  fillNeed(need, amount) {
    const c = AppState.character; if (!c) return;
    c.needs[need] = Math.min(100, c.needs[need] + amount);
    LS.save(c); EventBus.emit('character:needChanged', { need, value: c.needs[need] });
  },
  fillAll(amount = 20) {
    const c = AppState.character; if (!c) return;
    for (const k of Object.keys(c.needs)) c.needs[k] = Math.min(100, c.needs[k] + amount);
    LS.save(c); EventBus.emit('character:needChanged', { need: 'all' });
  },
  getEvolution() { const c = AppState.character; return c ? XP.getEvolution(c.level) : CONFIG.EVOLUTIONS[0]; },

  // Tap-to-earn: small XP, daily cap, no payment
  tap() {
    const c = AppState.character; if (!c || c.isSleeping) return 0;
    if (c.tapsToday >= 100) return -1; // capped
    c.tapsToday++; c.taps = (c.taps || 0) + 1;
    const gain = 1;
    c.xp += gain; c.totalXP += gain;
    while (c.xp >= XP.xpRequired(c.level)) { c.xp -= XP.xpRequired(c.level); c.level++; XP._onLevelUp(c.level); }
    c.xpToNext = XP.xpRequired(c.level);
    if (c.tapsToday % 20 === 0) LS.save(c);
    return gain;
  },
};

/* ════════════════════════════════════════════════════════════
   ACTIVITIES (free + premium)
   ════════════════════════════════════════════════════════════ */
const Activities = {
  _rand(a) { return a[Math.floor(Math.random() * a.length)]; },

  // Weighted lucky-box XP. Premium boxes (mega/whale/cosmic) roll higher.
  _rollLuckyXP(itemId) {
    const premium = ['mega_box', 'whale_chest', 'cosmic_gift'].includes(itemId);
    const r = Math.random();
    if (premium) {
      if (r < 0.45) return 150 + Math.floor(Math.random() * 150); // 150–300
      if (r < 0.85) return 300 + Math.floor(Math.random() * 200); // 300–500
      return 500 + Math.floor(Math.random() * 300);               // 500–800 jackpot
    }
    if (r < 0.55) return 80 + Math.floor(Math.random() * 70);     // 80–150
    if (r < 0.90) return 150 + Math.floor(Math.random() * 150);   // 150–300
    return 300 + Math.floor(Math.random() * 200);                 // 300–500 jackpot
  },

  // ── Free daily ──
  async gm() {
    const c = AppState.character; if (!c) return;
    if (c.daily.gm) { Toast.show('GM already sent — back tomorrow! 😴', 'warning', '⏰'); return; }
    const today = new Date().toISOString().split('T')[0];
    const yest = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (c.lastGM === yest) c.streak++; else if (c.lastGM !== today) c.streak = 1;
    c.lastGM = today; c.daily.gm = true;
    c.needs.hunger = Math.min(100, c.needs.hunger + 10);
    const bonus = Math.floor(50 * (1 + c.streak * 0.1));
    XP.add(bonus, `GM 🔥${c.streak}`);
    LS.save(c); EventBus.emit('activity:gm', { streak: c.streak });
    EventBus.emit('character:dialog', this._rand(CONFIG.DIALOGS.gm));
  },

  async feed() {
    const c = AppState.character; if (!c) return;
    if (c.daily.feed) { Toast.show('Already fed today! 🍽️', 'warning', '⏰'); return; }
    c.daily.feed = true; Character.fillNeed('hunger', 30); c.stats.totalFeeds++;
    XP.add(30, 'Feed'); LS.save(c); EventBus.emit('activity:feed');
  },

  async giveWater() {
    const c = AppState.character; if (!c) return;
    if (c.daily.water) { Toast.show('Already watered today! 💧', 'warning', '⏰'); return; }
    c.daily.water = true; Character.fillNeed('water', 40); c.stats.totalWaters++;
    XP.add(20, 'Water'); LS.save(c); EventBus.emit('activity:water');
  },

  async dailyCheckIn() {
    const c = AppState.character; if (!c) return;
    if (c.daily.checkin) { Toast.show('Check-in done! 📅', 'warning', '⏰'); return; }
    const today = new Date().toISOString().split('T')[0];
    const yest = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (c.lastCheckIn === yest) c.streak++;
    else if (c.lastCheckIn !== today) {
      if (c.lastCheckIn && c.lastCheckIn < yest) { Toast.show(`Streak broken 💔 (${c.streak}d)`, 'warning', '😢'); c.streak = 1; }
      else c.streak = 1;
    }
    c.lastCheckIn = today; c.daily.checkin = true;
    const idx = Math.min(c.streak - 1, CONFIG.LOGIN_REWARDS.length - 1);
    const bonus = CONFIG.LOGIN_REWARDS[idx];
    XP.add(bonus, `Check-in 🔥${c.streak}d`); Character.fillAll(10);
    LS.save(c); EventBus.emit('activity:checkin', { streak: c.streak });
  },

  // ── Premium helpers ──
  _recordPurchase(result, item) {
    const c = AppState.character; if (!c) return;
    c.stats.purchases = (c.stats.purchases || 0) + 1;
    c.stats.usdcSpent = +(((c.stats.usdcSpent || 0) + 0.05).toFixed(2));
    LS.save(c);
    EventBus.emit('activity:purchase', { item, result });
  },

  async buy(itemId) {
    const item = SHOP.find(itemId);
    if (!item) { Toast.show('Unknown item', 'error', '❓'); return; }
    try {
      const body = { address: AppState.wallet.address };
      if (item.action === 'costume') body.costumeId = item.id;
      const result = await X402.pay(item.action, body);
      const c = AppState.character;

      // Apply effects per item
      if (item.id === 'special_food') { Character.fillAll(25); XP.add(250, 'Feast'); }
      else if (item.id === 'energy_drink' || item.id === 'extra_life') { Character.fillNeed('energy', 100); XP.add(item.xp || 0, item.name); }
      else if (item.id === 'slow_time') { LS.setSetting('game_slowmo', true); XP.add(item.xp || 0, item.name); }
      else if (item.action === 'lucky_box') {
        const won = result.xpReward || Activities._rollLuckyXP(item.id);
        XP.add(won, `${item.name} 🎲`);
        LuckyReveal.show(item, won);
      }
      else if (item.id === 'xp_boost' || item.id === 'double_score') {
        const hrs = item.hours || 24;
        c.xpBoostUntil = Date.now() + hrs * 3600 * 1000;
        Toast.show(`${hrs}h 2x XP active! 🚀`, 'success', '⚡');
      }
      else if (item.id === 'xp_boost_3') { c.xpBoostUntil = Date.now() + 72 * 3600 * 1000; Toast.show('72h 2x XP active! 🌠', 'success', '⚡'); }
      else if (item.id === 'freeze') { c.freezeUntil = Date.now() + 24 * 3600 * 1000; XP.add(60, 'Freeze'); Toast.show('Needs frozen 24h 🧊', 'success', '🧊'); }
      else if (item.id === 'wake_up') { c.isSleeping = false; XP.add(80, 'Wake up'); }
      else if (item.action === 'costume') {
        c.costume = item.icon;
        if (!c.ownedCostumes.includes(item.id)) c.ownedCostumes.push(item.id);
        XP.add(item.xp || 80, item.name);
        Toast.show(`${item.name} equipped! ${item.icon}`, 'success', '👗');
      }

      this._recordPurchase(result, item);
      LS.save(c);
      Utils.vibrate([30, 20, 50]);
      return result;
    } catch (e) { console.warn('[buy]', itemId, e); }
  },

  // Equip an already-owned costume (free)
  equipCostume(itemId) {
    const c = AppState.character; if (!c) return;
    const item = SHOP.find(itemId); if (!item) return;
    c.costume = item.icon; LS.save(c);
    Toast.show(`${item.name} equipped! ${item.icon}`, 'success', '✨');
    EventBus.emit('character:costume', { itemId });
  },
  unequipCostume() {
    const c = AppState.character; if (!c) return;
    c.costume = null; LS.save(c);
    EventBus.emit('character:costume', { itemId: null });
  },
};

/* ════════════════════════════════════════════════════════════
   TOAST
   ════════════════════════════════════════════════════════════ */
const Toast = {
  _container: null,
  _getContainer() {
    if (!this._container) {
      this._container = document.getElementById('toast-container');
      if (!this._container) {
        this._container = document.createElement('div');
        this._container.id = 'toast-container'; this._container.className = 'toast-container';
        document.body.appendChild(this._container);
      }
    }
    return this._container;
  },
  show(message, type = 'success', icon = '✅', duration = 3200) {
    const c = this._getContainer();
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    const ic = document.createElement('span'); ic.className = 'toast-icon'; ic.textContent = icon;
    const tx = document.createElement('span'); tx.className = 'toast-text'; tx.textContent = message; // textContent = XSS-safe
    const cl = document.createElement('span'); cl.className = 'toast-close'; cl.textContent = '×';
    cl.onclick = () => el.remove();
    el.append(ic, tx, cl); c.appendChild(el);
    setTimeout(() => { el.classList.add('removing'); el.addEventListener('animationend', () => el.remove(), { once: true }); }, duration);
    const all = c.querySelectorAll('.toast'); if (all.length > 5) all[0].remove();
  },
};

/* ════════════════════════════════════════════════════════════
   EVOLUTION CINEMATIC
   ════════════════════════════════════════════════════════════ */
const Evolution = {
  show(evo) {
    let o = document.getElementById('evolution-overlay');
    if (!o) {
      o = document.createElement('div'); o.id = 'evolution-overlay'; o.className = 'evolution-overlay';
      o.innerHTML = `<div class="evolution-rays"></div>
        <div class="evolution-char" id="evo-char"></div>
        <div class="evolution-text evolution-text--name" id="evo-name"></div>
        <div class="evolution-text" style="font-size:15px;margin-top:8px;opacity:0.85;font-weight:500;" id="evo-desc"></div>
        <button class="btn btn--gold btn--lg" style="margin-top:30px;z-index:1;" onclick="Evolution.hide()">AWESOME! 🎉</button>`;
      document.body.appendChild(o);
    }
    document.getElementById('evo-char').textContent = evo.emoji;
    document.getElementById('evo-name').textContent = evo.name + ' unlocked!';
    document.getElementById('evo-desc').textContent = evo.desc;
    o.classList.add('active'); Confetti.rain(160);
    setTimeout(() => this.hide(), 15000);
  },
  hide() { const o = document.getElementById('evolution-overlay'); if (o) o.classList.remove('active'); },
};

/* ════════════════════════════════════════════════════════════
   LUCKY BOX REVEAL
   ════════════════════════════════════════════════════════════ */
const LuckyReveal = {
  show(item, xp) {
    const tier = xp >= 500 ? { label: 'JACKPOT!', cls: 'paid-badge--mythic', conf: 180 }
      : xp >= 300 ? { label: 'BIG WIN!', cls: 'paid-badge--hot', conf: 120 }
      : { label: 'Nice!', cls: '', conf: 60 };
    let o = document.getElementById('lucky-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'lucky-overlay'; o.className = 'evolution-overlay'; document.body.appendChild(o); }
    o.innerHTML = `<div class="evolution-rays"></div>
      <div class="evolution-char" style="animation:charPop 0.6s var(--ease-bounce);">${item.icon}</div>
      <div class="evolution-text text-gradient-gold">${tier.label}</div>
      <div class="evolution-text mono" style="font-size:40px;margin-top:6px;color:var(--neon-green);">+${xp} XP</div>
      <button class="btn btn--gold btn--lg" style="margin-top:28px;z-index:1;" onclick="LuckyReveal.hide()">COLLECT 💰</button>`;
    requestAnimationFrame(() => o.classList.add('active'));
    Confetti.rain(tier.conf); Utils.vibrate([40, 30, 60]);
  },
  hide() { const o = document.getElementById('lucky-overlay'); if (o) o.classList.remove('active'); },
};

/* ════════════════════════════════════════════════════════════
   CONFETTI
   ════════════════════════════════════════════════════════════ */
const Confetti = {
  COLORS: ['#2bd6ff', '#2bff9e', '#ffe14d', '#ff4d97', '#b76bff', '#ff8a3d'],
  rain(count = 80) { for (let i = 0; i < count; i++) setTimeout(() => this._spawn(), i * 22); },
  _spawn() {
    const el = document.createElement('div'); el.className = 'confetti-particle';
    const color = this.COLORS[Math.floor(Math.random() * this.COLORS.length)];
    const dur = 2000 + Math.random() * 2000; const size = 6 + Math.random() * 9;
    el.style.cssText = `left:${Math.random()*100}vw;width:${size}px;height:${size}px;background:${color};animation-duration:${dur}ms;border-radius:${Math.random()>0.5?'50%':'2px'};`;
    document.body.appendChild(el); setTimeout(() => el.remove(), dur + 100);
  },
};

/* ════════════════════════════════════════════════════════════
   PUSH NOTIF
   ════════════════════════════════════════════════════════════ */
const PushNotif = {
  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  },
  async send(title, body, icon = 'icon-192.png') {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body, icon }); } catch (e) { console.warn('[Push]', e); }
  },
};

/* ════════════════════════════════════════════════════════════
   EVENT BUS
   ════════════════════════════════════════════════════════════ */
const EventBus = {
  _l: {},
  on(ev, fn) { (this._l[ev] = this._l[ev] || []).push(fn); return () => this.off(ev, fn); },
  off(ev, fn) { if (this._l[ev]) this._l[ev] = this._l[ev].filter(f => f !== fn); },
  emit(ev, data) { (this._l[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(`[Bus] ${ev}`, e); } }); },
  once(ev, fn) { const u = this.on(ev, d => { fn(d); u(); }); },
};

/* ════════════════════════════════════════════════════════════
   UTILS
   ════════════════════════════════════════════════════════════ */
const Utils = {
  formatDate(ts) { return new Date(ts).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }); },
  shortNum(n) { if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1e3) return (n/1e3).toFixed(1)+'K'; return String(n); },
  debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
  throttle(fn, ms) { let l = 0; return (...a) => { const n = Date.now(); if (n - l >= ms) { l = n; fn(...a); } }; },
  async copy(text) { try { await navigator.clipboard.writeText(text); Toast.show('Copied!', 'success', '📋'); } catch { Toast.show('Copy failed', 'error', '❌'); } },
  vibrate(p = [30]) { if ('vibrate' in navigator) navigator.vibrate(p); },
  formatDuration(ms) { if (ms < 1000) return `${ms}ms`; const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60); if (h) return `${h}h ${m%60}m`; if (m) return `${m}m ${s%60}s`; return `${s}s`; },
  generateReferralCode(addr) { return 'BXP' + addr.slice(2, 8).toUpperCase(); },
  boostRemainingText() { const c = AppState.character; if (!c?.xpBoostUntil) return null; const r = c.xpBoostUntil - Date.now(); return r > 0 ? this.formatDuration(r) : null; },
  escape(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
};

/* ════════════════════════════════════════════════════════════
   NAV
   ════════════════════════════════════════════════════════════ */
const Nav = {
  items: [
    { page: 'index',  icon: '🐾', label: 'Pet',    href: 'index.html'  },
    { page: 'shop',   icon: '🛒', label: 'Shop',   href: 'shop.html'   },
    { page: 'games',  icon: '🎮', label: 'Games',  href: 'games.html'  },
    { page: 'world',  icon: '🗺️', label: 'World',  href: 'world.html'  },
    { page: 'social', icon: '🎁', label: 'Invite', href: 'social.html' },
  ],
  render(cur) {
    const nav = document.querySelector('.bottom-nav'); if (!nav) return;
    nav.innerHTML = this.items.map(i =>
      `<a href="${i.href}" class="nav-item ${i.page === cur ? 'active' : ''}"><span class="nav-icon">${i.icon}</span><span>${i.label}</span></a>`
    ).join('');
    nav.style.display = 'flex';
  },
};

/* ════════════════════════════════════════════════════════════
   WALLET MODAL
   ════════════════════════════════════════════════════════════ */
const WalletModal = {
  show() {
    let m = document.getElementById('wallet-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'wallet-modal'; m.className = 'modal-overlay';
      m.innerHTML = `<div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-title text-gradient-blue">Connect Wallet 🔗</div>
        <p style="text-align:center;color:var(--text-secondary);font-size:14px;margin-bottom:22px;">Connect to start raising your crypto pet</p>
        <div class="flex flex-col gap-sm">
          <button class="btn btn--primary btn--full btn--lg btn--shine" id="connect-metamask"><span>🦊</span> MetaMask</button>
          <button class="btn btn--ghost btn--full btn--lg" id="connect-coinbase"><span>💙</span> Coinbase Wallet</button>
          <button class="btn btn--ghost btn--full" onclick="WalletModal.hide()" style="margin-top:6px;color:var(--text-muted);">Not now</button>
        </div>
        <p style="text-align:center;color:var(--text-muted);font-size:11px;margin-top:14px;">You'll be switched to Base network automatically</p>
      </div>`;
      document.body.appendChild(m);
      document.getElementById('connect-metamask').onclick = async () => { WalletModal.hide(); await Wallet.connect('metamask').catch(()=>{}); };
      document.getElementById('connect-coinbase').onclick = async () => { WalletModal.hide(); await Wallet.connect('coinbase').catch(()=>{}); };
      m.addEventListener('click', e => { if (e.target === m) WalletModal.hide(); });
    }
    requestAnimationFrame(() => m.classList.add('open'));
  },
  hide() { const m = document.getElementById('wallet-modal'); if (m) m.classList.remove('open'); },
};

/* ════════════════════════════════════════════════════════════
   APP INIT
   ════════════════════════════════════════════════════════════ */
const App = {
  async init(pageName = 'index') {
    AppState.ui.currentPage = pageName;
    Nav.render(pageName);
    if (!document.getElementById('bg-scene')) {
      const bg = document.createElement('div'); bg.id = 'bg-scene'; bg.className = 'bg-scene';
      bg.innerHTML = `<div class="bg-orb bg-orb--1"></div><div class="bg-orb bg-orb--2"></div><div class="bg-orb bg-orb--3"></div>`;
      document.body.insertBefore(bg, document.body.firstChild);
    }
    // starfield
    if (!document.getElementById('bg-stars')) {
      const sf = document.createElement('div'); sf.id = 'bg-stars'; sf.className = 'bg-stars';
      for (let i = 0; i < 30; i++) {
        const s = document.createElement('div'); s.className = 'bg-star';
        s.style.cssText = `left:${Math.random()*100}%;top:${Math.random()*100}%;animation-delay:${Math.random()*3}s;`;
        sf.appendChild(s);
      }
      document.body.insertBefore(sf, document.body.firstChild);
    }
    Toast._getContainer();
    const reconnected = await Wallet.autoReconnect();
    if (!reconnected) EventBus.emit('wallet:disconnected');
    PushNotif.requestPermission().catch(()=>{});
    console.log(`[BaseXP] ${pageName} ready`);
  },
};

/* ════════════════════════════════════════════════════════════
   EXPORTS
   ════════════════════════════════════════════════════════════ */
window.BaseXP = { CONFIG, SHOP, AppState, Wallet, WalletModal, X402, XP, Character, Activities, Toast, Evolution, LuckyReveal, Confetti, PushNotif, EventBus, Utils, Nav, App, LS, KVSync };
Object.assign(window, { CONFIG, SHOP, AppState, Wallet, WalletModal, X402, XP, Character, Activities, Toast, Evolution, LuckyReveal, Confetti, EventBus, Utils, Nav, App, LS });
