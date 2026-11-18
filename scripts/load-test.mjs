#!/usr/bin/env node
/**
 * Test de charge RÉEL contre un projet Supabase (pas de simulation).
 *
 *   node scripts/load-test.mjs [--players 20] [--duration 120] [--hunters 6]
 *
 * Variables lues dans apps/mobile/.env (ou l environnement) :
 *   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY
 *
 * Ce que fait le script :
 *  1. connecte N joueurs invités (sessions mises en cache dans
 *     .load-test-sessions.json pour ne pas épuiser la limite d'inscriptions
 *     anonymes : 30 / heure / IP par défaut) ;
 *  2. crée un salon, fait rejoindre tout le monde, répartit les équipes, lance ;
 *  3. abonne chaque joueur à ses 3 canaux privés (public, équipe, personnel) ;
 *  4. joue des positions GPS SIMULÉES (marche aléatoire dans une zone de test),
 *     captures, heartbeat, ticks) ;
 *  5. à mi-parcours, coupe et rétablit le Realtime de 3 joueurs (reconnexion) ;
 *  6. mesure : abonnements réussis, messages reçus, latence serveur -> client,
 *     trous/doublons de séquence, impulsions radar, erreurs, latence RPC ;
 *  7. interrompt la partie et quitte le salon.
 *
 * ATTENTION : consomme du quota Realtime (~ quelques dizaines de milliers de
 * messages pour 2 minutes à 20 joueurs). Le forfait gratuit ne facture rien :
 * en cas de dépassement, Supabase limite/suspend, il ne débite pas.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// ---------- configuration ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const PLAYERS = Math.min(20, Math.max(2, Number(args.players ?? 20)));
const HUNTERS = Math.min(PLAYERS - 1, Math.max(1, Number(args.hunters ?? Math.round(PLAYERS * 0.3))));
const DURATION_S = Math.max(30, Number(args.duration ?? 120));

for (const f of ["apps/mobile/.env", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !KEY) {
  console.error("✗ EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY manquants (apps/mobile/.env).");
  process.exit(2);
}

const SESSIONS_FILE = ".load-test-sessions.json";
const cache = existsSync(SESSIONS_FILE) ? JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null);

const stats = {
  rpc: [],
  errors: {},
  received: 0,
  latency: [],
  gaps: 0,
  dups: 0,
  radar: 0,
  subscribed: 0,
  subscribeFailures: 0,
  reconnectOk: 0,
  resyncConsistent: 0,
};

async function rpc(p, fn, params = {}) {
  const t0 = performance.now();
  const { data, error } = await p.sb.rpc(fn, params);
  stats.rpc.push(performance.now() - t0);
  const code = error?.message ?? (data && typeof data === "object" && typeof data.error === "string" ? data.error : null);
  if (code) {
    stats.errors[code] = (stats.errors[code] ?? 0) + 1;
    throw new Error(code);
  }
  return data;
}

// ---------- 1. joueurs ----------
async function makePlayer(i) {
  const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: true } });
  const key = `p${i}`;
  let session = null;
  if (cache[key]?.refresh_token) {
    const { data } = await sb.auth.refreshSession({ refresh_token: cache[key].refresh_token });
    session = data.session;
  }
  if (!session) {
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) throw new Error(`Inscription invitée impossible (${error.message}). Activez "Allow anonymous sign-ins".`);
    session = data.session;
  }
  cache[key] = { refresh_token: session.refresh_token };
  const p = { i, sb, uid: session.user.id, seq: {}, offset: 0, channels: [] };
  await rpc(p, "update_my_profile", { p_username: `Charge${String(i).padStart(2, "0")}`, p_avatar: "grid:steel" }).catch(() => {});
  // Horloge : 3 échantillons
  const samples = [];
  for (let k = 0; k < 3; k++) {
    const t0 = Date.now();
    const server = await rpc(p, "server_time");
    const t1 = Date.now();
    samples.push({ rtt: t1 - t0, offset: server - (t0 + (t1 - t0) / 2) });
  }
  p.offset = samples.sort((a, b) => a.rtt - b.rtt)[0].offset;
  return p;
}

// ---------- 3. canaux ----------
function onEvent(p, msg) {
  stats.received++;
  const ev = msg.payload;
  const last = p.seq[ev.s];
  if (last !== undefined) {
    if (ev.sn <= last) stats.dups++;
    else if (ev.sn > last + 1) stats.gaps++;
  }
  p.seq[ev.s] = Math.max(last ?? 0, ev.sn);
  stats.latency.push(Date.now() + p.offset - ev.at);
  if (ev.t === "radar") stats.radar++;
}

async function subscribe(p, gameId) {
  await p.sb.realtime.setAuth(p.sb.auth ? (await p.sb.auth.getSession()).data.session.access_token : undefined);
  const topics = [`game:${gameId}:all`, `game:${gameId}:${p.team}`, `game:${gameId}:p:${p.uid}`];
  p.channels = [];
  await Promise.all(
    topics.map(
      (t) =>
        new Promise((resolve) => {
          const ch = p.sb.channel(t, { config: { private: true } }).on("broadcast", { event: "ev" }, (m) => onEvent(p, m));
          const timer = setTimeout(() => {
            stats.subscribeFailures++;
            resolve();
          }, 15000);
          ch.subscribe((st) => {
            if (st === "SUBSCRIBED") {
              clearTimeout(timer);
              stats.subscribed++;
              resolve();
            } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") {
              clearTimeout(timer);
              stats.subscribeFailures++;
              resolve();
            }
          });
          p.channels.push(ch);
        }),
    ),
  );
}

async function resync(p, gameId) {
  const v = await rpc(p, "get_game_view", { p_game: gameId });
  p.view = v;
  p.status = v.me.status;
  p.seq = { all: v.streams.all, [v.me.team]: v.streams.team, [`p:${p.uid}`]: v.streams.p };
  return v;
}

// Zone de test (positions simulées, aucune position réelle n'est utilisée).
const ZONE = { lat: 48.8556, lng: 2.2986, radius_m: 600, label: "Test de charge", set: true };
const M = 111320;
function toLatLng(e, so) {
  return { lat: ZONE.lat - so / M, lng: ZONE.lng + e / (M * Math.cos((ZONE.lat * Math.PI) / 180)) };
}
/** Marche aléatoire à ~1,5 m/s, bornée dans la zone. */
function walk(p, seconds) {
  const a = Math.random() * Math.PI * 2;
  const d = 1.5 * seconds;
  p.e = Math.max(-500, Math.min(500, p.e + Math.cos(a) * d));
  p.s = Math.max(-500, Math.min(500, p.s + Math.sin(a) * d));
}

// ---------- scénario ----------
async function main() {
  console.log(`▶ Test de charge : ${PLAYERS} joueurs (${HUNTERS} Chasseurs), ${DURATION_S} s, ${URL}`);
  const players = [];
  for (let i = 0; i < PLAYERS; i++) {
    players.push(await makePlayer(i));
    process.stdout.write(".");
  }
  writeFileSync(SESSIONS_FILE, JSON.stringify(cache, null, 2));
  console.log(`\n✓ ${players.length} joueurs connectés`);

  const host = players[0];
  const room = await rpc(host, "create_room", {
    p_name: `Charge ${new Date().toISOString().slice(11, 19)}`,
    p_config: { prep_s: 0, duration_s: Math.max(300, DURATION_S + 120), zone: ZONE, radar: { interval_s: 30 }, position_interval_s: 5 },
    p_max_players: 20,
    p_allow_team_choice: false,
  });
  await Promise.all(players.slice(1).map((p) => rpc(p, "join_room", { p_code: room.code })));
  for (const [k, p] of players.entries()) {
    p.team = k < HUNTERS ? "hunter" : "fugitive";
    await rpc(host, "set_member_team", { p_room: room.room_id, p_user: p.uid, p_team: p.team });
  }
  await Promise.all(players.map((p) => rpc(p, "set_location_consent", { p_room: room.room_id, p_consent: true })));
  const { game_id: gameId } = await rpc(host, "start_game", { p_room: room.room_id });
  console.log(`✓ Partie lancée (${gameId}), salon ${room.code}`);

  const t0 = Date.now();
  await Promise.all(players.map((p) => subscribe(p, gameId)));
  console.log(`✓ Abonnements : ${stats.subscribed}/${players.length * 3} en ${Date.now() - t0} ms (${stats.subscribeFailures} échecs)`);
  await Promise.all(players.map((p) => resync(p, gameId)));

  const end = Date.now() + DURATION_S * 1000;
  let reconnectDone = false;
  const loops = players.map(async (p, idx) => {
    await sleep(idx * 97);
    let lastBeat = 0, lastTick = 0, lastPos = Date.now();
    p.e = (Math.random() - 0.5) * 600;
    p.s = (Math.random() - 0.5) * 600;
    while (Date.now() < end) {
      try {
        if (Date.now() - lastBeat > 15000) {
          await rpc(p, "heartbeat", { p_game: gameId });
          lastBeat = Date.now();
        }
        if (Date.now() - lastTick > 10000 + idx * 300) {
          await rpc(p, "game_tick", { p_game: gameId });
          lastTick = Date.now();
        }
        if (p.status === "active") {
          if (p.team === "hunter" && Math.random() < 0.2) await rpc(p, "attempt_capture", { p_game: gameId }).catch(() => {});
          else {
            walk(p, (Date.now() - lastPos) / 1000);
            lastPos = Date.now();
            const g = toLatLng(p.e, p.s);
            await rpc(p, "report_position", {
              p_game: gameId, p_lat: g.lat, p_lng: g.lng, p_accuracy: 5 + Math.random() * 10, p_recorded_at: Date.now() + p.offset,
            }).catch(() => null);
          }
        }
      } catch {
        /* erreurs comptées dans stats.errors */
      }
      await sleep(4500 + Math.random() * 1000);
      if (!p.status || Math.random() < 0.05) {
        const v = await resync(p, gameId).catch(() => null);
        if (v?.game.phase === "finished") return;
      }
    }
  });

  // Reconnexion de 3 joueurs à mi-parcours
  const reconnect = (async () => {
    await sleep((DURATION_S * 1000) / 2);
    const victims = players.slice(-3);
    for (const p of victims) await Promise.all(p.channels.map((c) => p.sb.removeChannel(c)));
    console.log("… 3 joueurs coupés du Realtime pendant 5 s");
    await sleep(5000);
    for (const p of victims) {
      const before = { ...p.seq };
      await subscribe(p, gameId);
      const v = await resync(p, gameId);
      stats.reconnectOk++;
      if (v.streams.all >= (before.all ?? 0)) stats.resyncConsistent++;
    }
    reconnectDone = true;
  })();

  await Promise.all([...loops, reconnect]);

  // Nettoyage
  await rpc(host, "abort_game", { p_game: gameId }).catch(() => {});
  await Promise.all(players.map((p) => p.sb.removeAllChannels()));
  for (const p of players) await rpc(p, "leave_room", { p_room: room.room_id }).catch(() => {});

  const r = (v) => (v === null ? "—" : `${Math.round(v)} ms`);
  console.log("\n================ RÉSULTATS ================");
  console.log(`Joueurs                     : ${PLAYERS}`);
  console.log(`Abonnements Realtime        : ${stats.subscribed} réussis / ${stats.subscribeFailures} échecs`);
  console.log(`Messages reçus              : ${stats.received} (${(stats.received / DURATION_S).toFixed(1)} / s)`);
  console.log(`Latence serveur → client    : p50 ${r(pct(stats.latency, 0.5))} · p95 ${r(pct(stats.latency, 0.95))} · max ${r(pct(stats.latency, 1))}`);
  console.log(`Trous / doublons de séquence: ${stats.gaps} / ${stats.dups}`);
  console.log(`Impulsions radar reçues     : ${stats.radar} (Chasseurs, toutes les 30 s)`);
  console.log(`Reconnexions                : ${stats.reconnectOk}/3 (resync cohérente : ${stats.resyncConsistent})${reconnectDone ? "" : " (non terminée)"}`);
  console.log(`Appels RPC                  : ${stats.rpc.length} · p50 ${r(pct(stats.rpc, 0.5))} · p95 ${r(pct(stats.rpc, 0.95))}`);
  console.log(`Erreurs (codes)             : ${JSON.stringify(stats.errors)}`);
  console.log("Erreurs attendues (règles)  : E_COOLDOWN, E_RATE_LIMITED, E_NOT_ACTIVE, E_POSITION_REQUIRED, E_GAME_FINISHED");
  const fatal = stats.subscribeFailures > 0 || Object.keys(stats.errors).some((c) => !/^E_/.test(c) || c === "E_INTERNAL");
  console.log(fatal ? "✗ Des anomalies sont à analyser." : "✓ Aucun problème bloquant détecté.");
  process.exit(fatal ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ Échec :", e.message);
  process.exit(1);
});
