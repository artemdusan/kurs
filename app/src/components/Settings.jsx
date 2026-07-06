import React, { useState } from 'react';
import { saveSettings } from '../db.js';
import { syncNow, DEFAULT_SYNC_URL, resolveSyncUrl } from '../sync.js';
import Icon from './Icon.jsx';

export default function Settings({ settings, onChange, onBack }) {
  const [form, setForm] = useState(settings);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncing, setSyncing] = useState(false);

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
      <label className="field">
        Adres serwera (Cloudflare Worker)
        <input
          type="url"
          placeholder={DEFAULT_SYNC_URL || 'https://kurs.example.workers.dev'}
          value={form.syncUrl} onChange={(e) => set('syncUrl', e.target.value)}
        />
        {DEFAULT_SYNC_URL && !form.syncUrl && (
          <small className="hint">Używany domyślny adres z konfiguracji: {DEFAULT_SYNC_URL}</small>
        )}
      </label>
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
    </div>
  );
}
