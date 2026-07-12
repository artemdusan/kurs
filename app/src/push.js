import { getSettings } from './db.js';
import { resolveSyncUrl } from './sync.js';

// Powiadomienia push: subskrypcja trafia do Workera (D1), który o 19:00
// czasu polskiego wysyła przypomnienie, jeśli danego dnia nie było sesji.
// Push jest bez payloadu (nie wymaga szyfrowania RFC 8291) — treść
// przypomnienia jest na stałe w service workerze (public/push-sw.js).

function urlBase64ToUint8Array(base64) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function authHeader(settings) {
  return 'Basic ' + btoa(`${settings.syncLogin}:${settings.syncPassword}`);
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// 'unsupported' | 'denied' | 'on' | 'off'
export async function getPushState() {
  if (!pushSupported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) return 'on';
  return Notification.permission === 'denied' ? 'denied' : 'off';
}

export async function enablePush() {
  const settings = await getSettings();
  const url = resolveSyncUrl(settings);
  if (!url || !settings.syncLogin) {
    throw new Error('Najpierw skonfiguruj synchronizację (adres + login)');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Brak zgody na powiadomienia w przeglądarce');

  const vapidRes = await fetch(url + '/push/vapid');
  const { key } = vapidRes.ok ? await vapidRes.json() : {};
  if (!key) throw new Error('Serwer nie ma skonfigurowanych kluczy VAPID');

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
  const res = await fetch(url + '/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(settings) },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) {
    await sub.unsubscribe().catch(() => {});
    throw new Error(`Zapis subskrypcji nieudany (${res.status})`);
  }
}

export async function disablePush() {
  const settings = await getSettings();
  const url = resolveSyncUrl(settings);
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  if (url && settings.syncLogin) {
    await fetch(url + '/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader(settings) },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
  }
}
