import React, { useEffect, useState } from 'react';
import { saveSettings } from '../db.js';
import { syncNow, DEFAULT_SYNC_URL, resolveSyncUrl } from '../sync.js';
import { getPushState, enablePush, disablePush } from '../push.js';
import { CONTENT_VERSION } from '../course.js';
import Icon from './Icon.jsx';

// wstrzykiwana przy buildzie z package.json (vite.config.js: define)
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

export default function Settings({ settings, index, onChange, onSynced, onBack }) {
  const [form, setForm] = useState(settings);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [pushState, setPushState] = useState('unsupported'); // unsupported | denied | on | off
  const [pushMsg, setPushMsg] = useState('');
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    getPushState().then(setPushState);
  }, []);

  async function togglePush() {
    setPushBusy(true);
    setPushMsg('');
    try {
      if (pushState === 'on') {
        await disablePush();
      } else {
        await enablePush();
      }
      setPushState(await getPushState());
    } catch (e) {
      setPushMsg(e.message);
      setPushState(await getPushState());
    } finally {
      setPushBusy(false);
    }
  }

  function set(key, value) {
    const next = { ...form, [key]: value };
    setForm(next);
    saveSettings(next);
    onChange(next);
  }

  async function doSync() {
    setSyncing(true);
    setSyncMsg('');
    try {
      const r = await syncNow();
      setSyncMsg(`Zsynchronizowano: wysłano ${r.sent}, odebrano ${r.received}`);
      onSynced?.(); // odśwież stan aplikacji bez przeładowania strony
    } catch (e) {
      setSyncMsg(e.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="screen settings">
      <div className="session-top">
        <button className="btn ghost" onClick={onBack} aria-label="Wróć">
          <Icon name="back" />
        </button>
        <h2>Ustawienia</h2>
        <span />
      </div>

      <label className="field">
        Długość sesji (minuty)
        <input
          type="number" min="3" max="60" value={form.sessionMinutes}
          onChange={(e) => set('sessionMinutes', Number(e.target.value) || 10)}
        />
      </label>

      <label className="field">
        Dzienny cel nauki (minuty — zielona buźka)
        <input
          type="number" min="1" max="120" value={form.dailyGoalMinutes}
          onChange={(e) => set('dailyGoalMinutes', Number(e.target.value) || 10)}
        />
      </label>

      <label className="field row">
        <input
          type="checkbox" checked={form.accentTolerance}
          onChange={(e) => set('accentTolerance', e.target.checked)}
        />
        Tolerancja błędów akcentów (á = a)
      </label>

      <label className="field row">
        <input
          type="checkbox" checked={form.tts}
          onChange={(e) => set('tts', e.target.checked)}
        />
        Czytaj na głos poprawną odpowiedź
      </label>

      <label className="field">
        Wymagany poziom do odblokowania lekcji (floor)
        <input
          type="number" min="2" max="5" value={form.floorLevel}
          onChange={(e) => set('floorLevel', Number(e.target.value) || 2)}
        />
      </label>

      <h3>Synchronizacja (opcjonalna)</h3>
      {/* Adres serwera jest wstrzykiwany przy buildzie (VITE_SYNC_URL) — pole
          pokazujemy tylko, gdy build nie ma skonfigurowanego adresu. */}
      {!DEFAULT_SYNC_URL && (
        <label className="field">
          Adres serwera (Cloudflare Worker)
          <input
            type="url"
            placeholder="https://kurs.example.workers.dev"
            value={form.syncUrl} onChange={(e) => set('syncUrl', e.target.value)}
          />
        </label>
      )}
      <label className="field">
        Login
        <input value={form.syncLogin} onChange={(e) => set('syncLogin', e.target.value)} />
      </label>
      <label className="field">
        Hasło
        <input
          type="password" value={form.syncPassword}
          onChange={(e) => set('syncPassword', e.target.value)}
        />
      </label>
      <div className="row gap">
        <button className="btn primary" disabled={syncing} onClick={doSync}>
          {syncing ? 'Synchronizuję…' : 'Synchronizuj teraz'}
        </button>
        {resolveSyncUrl(form) && (
          <a
            className="btn"
            href={resolveSyncUrl(form) + '/dashboard'}
            target="_blank" rel="noreferrer"
          >
            Dashboard
          </a>
        )}
      </div>
      {syncMsg && <p className="sync-msg">{syncMsg}</p>}

      <h3>Przypomnienia</h3>
      <p className="hint">
        Powiadomienie o 19:00, jeśli danego dnia nie było jeszcze sesji.
        Wymaga skonfigurowanej synchronizacji.
      </p>
      {pushState === 'unsupported' ? (
        <p className="sync-msg">Ta przeglądarka nie obsługuje powiadomień push.</p>
      ) : pushState === 'denied' ? (
        <p className="sync-msg">Powiadomienia zablokowane w ustawieniach przeglądarki.</p>
      ) : (
        <button className="btn" disabled={pushBusy} onClick={togglePush}>
          {pushBusy
            ? 'Chwileczkę…'
            : pushState === 'on'
              ? 'Wyłącz przypomnienia'
              : 'Włącz przypomnienia'}
        </button>
      )}
      {pushMsg && <p className="sync-msg">{pushMsg}</p>}

      <h3>O aplikacji</h3>
      <p className="about-versions">
        Aplikacja: v{APP_VERSION}
        <br />
        Baza kursu: v{index?.wersja || '?'} (schemat danych: {CONTENT_VERSION})
      </p>
    </div>
  );
}
