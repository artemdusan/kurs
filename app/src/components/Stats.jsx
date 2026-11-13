import React, { useEffect, useState } from 'react';
import { getMeta, getSettings } from '../db.js';
import { dayStatus, bestStreak } from '../engine/session.js';
import { loadDeck, deckGoals, cardBuckets, hardWords, playerXp, playerLevel, challengeBonus, rankFor, heartStock, jokerStock, HEART_STOCK_MAX, JOKER_MAX } from '../engine/insights.js';
import LevelBars from './LevelBars.jsx';
import { getDailyStats } from '../activity.js';
import { localDay, shiftDay, currentStreak } from '../../../shared/learning.js';
import Icon, { FaceIcon } from './Icon.jsx';
import { POSTCARDS, postcards } from '../engine/journey.js';

// Statystyki na jednym ekranie telefonu, bez przewijania: seria i dzisiejszy cel,
// kalendarz 5 tygodni, droga do kolejnej lekcji, stan talii, skuteczność.
// Reszta (średnie, wykres awansów, pełny rozkład poziomów) jest pod „Szczegóły”.

const WEEKDAYS = ['P', 'W', 'Ś', 'C', 'P', 'S', 'N'];
const CALENDAR_WEEKS = 5;

function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) days.push(shiftDay(localDay(), -i));
  return days;
}

/** 5 pełnych tygodni (pon.–niedz.) kończących się bieżącym tygodniem. */
export function calendarDays(today = localDay()) {
  const [y, m, d] = today.split('-').map(Number);
  const weekday = (new Date(y, m - 1, d, 12).getDay() + 6) % 7; // 0 = poniedziałek
  const start = shiftDay(today, -weekday - 7 * (CALENDAR_WEEKS - 1));
  return Array.from({ length: CALENDAR_WEEKS * 7 }, (_, i) => shiftDay(start, i));
}

export default function Stats({ maxLesson, lessonCount = 100, onBack, onHard }) {
  const [data, setData] = useState(null);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const deck = await loadDeck(maxLesson);
      const album = await postcards();
      const levelsObj = {};
      let maxLevel = 1;
      for (const { level } of deck) {
        levelsObj[level] = (levelsObj[level] || 0) + 1;
        if (level > maxLevel) maxLevel = level;
      }
      const levels = [];
      for (let i = 1; i <= Math.max(maxLevel, 6); i++) levels.push(levelsObj[i] || 0);

      const settings = await getSettings();
      const goalMin = settings.dailyGoalMinutes || 10;
      const daily = await getDailyStats();
      const historySince = await getMeta('levelHistorySince');
      const days = lastNDays(7).map((day) => ({
        day, correct: 0, wrong: 0, seconds: 0, advances: 0, drops: 0,
        known: Boolean(historySince && day >= historySince),
        ...(daily[day] || {}),
      }));
      let totalSeconds = 0;
      let totalSessions = 0;
      let totalCorrect = 0;
      let totalWrong = 0;
      let activeDays = 0;
      for (const d of Object.values(daily)) {
        totalSeconds += d.seconds || 0;
        totalSessions += d.sessions || 0;
        totalCorrect += d.correct || 0;
        totalWrong += d.wrong || 0;
        if ((d.correct || 0) + (d.wrong || 0) > 0) activeDays++;
      }
      const weekCorrect = days.reduce((n, d) => n + d.correct, 0);
      const weekWrong = days.reduce((n, d) => n + d.wrong, 0);
      const todayKey = localDay();
      const today = daily[todayKey] || {};
      const streak = currentStreak(daily);
      if (cancelled) return;
      setData({
        levels,
        wordCount: deck.length,
        goals: deckGoals(deck),
        buckets: cardBuckets(deck),
        days,
        calendar: calendarDays(todayKey).map((day) => ({
          day,
          future: day > todayKey,
          today: day === todayKey,
          status: dayStatus(daily[day], goalMin),
          frozen: streak.frozen.includes(day),
        })),
        freezeAvailable: streak.freezeAvailable,
        hardCount: hardWords(deck).length,
        goalMin,
        todayStatus: dayStatus(today, goalMin),
        streak: streak.count || 0,
        bestStreak: Math.max(bestStreak(daily), streak.count || 0),
        pairsBest: await getMeta('pairsBest', 0),
        roadBest: await getMeta('roadBest', 0),
        postcards: POSTCARDS.filter((p) => album[p.key]).length,
        player: playerLevel(playerXp(daily, await challengeBonus())),
        empty: Object.keys(daily).length === 0,
        hearts: await heartStock(),
        jokers: await jokerStock(),
        weekAccuracy: weekCorrect + weekWrong ? Math.round((weekCorrect / (weekCorrect + weekWrong)) * 100) : null,
        time: {
          todayMin: Math.floor((today.seconds || 0) / 60),
          avgMin: activeDays ? Math.round(totalSeconds / activeDays / 60) : 0,
          totalMin: Math.round(totalSeconds / 60),
          sessions: totalSessions,
          accuracy: totalCorrect + totalWrong ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100) : 0,
        },
      });
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [maxLesson]);

  if (!data) return <div className="screen center">Liczenie statystyk…</div>;

  const header = (title, back) => (
    <div className="session-top">
      <button className="btn ghost" onClick={back} aria-label="Wróć">
        <Icon name="back" />
      </button>
      <h2>{title}</h2>
      <span className="top-spacer" />
    </div>
  );

  if (details) {
    return (
      <div className="screen stats">
        {header('Szczegóły', () => setDetails(false))}
        <div className="time-grid">
          <div className="time-cell"><span className="time-num">{data.time.avgMin}</span><span className="time-label">min/dzień nauki</span></div>
          <div className="time-cell"><span className="time-num">{Math.floor(data.time.totalMin / 60)}h {data.time.totalMin % 60}m</span><span className="time-label">łącznie</span></div>
          <div className="time-cell"><span className="time-num">{data.time.sessions}</span><span className="time-label">sesji</span></div>
          <div className="time-cell"><span className="time-num">{data.time.accuracy}%</span><span className="time-label">skuteczność ogółem</span></div>
          <div className="time-cell"><span className="time-num">{data.bestStreak}</span><span className="time-label">rekord serii</span></div>
          <div className="time-cell"><span className="time-num">{data.wordCount}</span><span className="time-label">kart w talii</span></div>
        </div>

        <h3>Postęp (7 dni)</h3>
        <div className="progress-legend">
          <span className="num-ok">↑ {data.days.reduce((n, d) => n + d.advances, 0)} awansów</span>
          <span className="num-bad">↓ {data.days.reduce((n, d) => n + d.drops, 0)} spadków</span>
        </div>
        <div className="progress-days">
          {data.days.map((d) => {
            const max = Math.max(1, ...data.days.flatMap((x) => [x.advances, x.drops]));
            const label = d.known ? `${d.day}: ${d.advances} awansów, ${d.drops} spadków` : `${d.day}: brak danych`;
            return (
              <div className="progress-day" key={d.day} title={label} aria-label={label} tabIndex={0}>
                <div className="progress-values">{d.known ? <><span className="num-ok">{d.advances}</span> / <span className="num-bad">{d.drops}</span></> : '—'}</div>
                <div className={'progress-pair' + (d.known ? '' : ' no-data')}>
                  {d.known && <>
                    <div className="progress-up" style={{ height: `${d.advances / max * 100}%` }} />
                    <div className="progress-down" style={{ height: `${d.drops / max * 100}%` }} />
                  </>}
                </div>
                <span className="day-col-label">{d.day.slice(8)}.{d.day.slice(5, 7)}</span>
              </div>
            );
          })}
        </div>
        {data.days.some((d) => !d.known) && <p className="hint">— brak danych sprzed rozpoczęcia zapisu zmian poziomów.</p>}

        <h3>Poziomy kart ({data.wordCount})</h3>
        <LevelBars levels={data.levels} />
      </div>
    );
  }

  const goalSegments = Math.min(10, data.goalMin);
  const goalDone = Math.min(goalSegments, Math.floor((data.time.todayMin / data.goalMin) * goalSegments));
  const { goals, buckets } = data;
  const total = Math.max(1, goals.total);
  const allOpen = maxLesson >= lessonCount;

  return (
    <div className="screen stats stats-one">
      {header('Statystyki', onBack)}

      <div className="xp-bar" title={`Łącznie ${data.player.xp} XP`}>
        <span className="xp-level">LV {data.player.level}</span>
        <div className="xp-track"><div className="xp-fill" style={{ width: Math.min(100, (data.player.into / data.player.need) * 100) + '%' }} /></div>
        <span className="xp-num">{data.player.into}/{data.player.need} XP</span>
      </div>
      <p className="rank-line">
        <b>{rankFor(data.player.level).label}</b>
        <span>do kolejnej rangi: {rankFor(data.player.level).toNext} poz.</span>
        <span className="rank-hearts" title="Każda nowa ranga daje serce na bossa; zużywa się dopiero, gdy uratuje walkę"><Icon name="heart" size={12} /> {data.hearts}/{HEART_STOCK_MAX}</span>
        <span className="rank-hearts rank-joker" title="Każdy poziom daje jokera 50/50 na bossa (raz na walkę)"><Icon name="joker" size={12} /> {data.jokers}/{JOKER_MAX}</span>
      </p>
      <p className="rank-rewards">Każdy poziom: joker 50/50 · nowa ranga: serce na bossa i nowy lakier auta w „Drodze” · przy pełnym zapasie +100 XP</p>
      {data.empty && <p className="stats-empty">Tu pojawi się Twoja historia. Wystarczy pierwsza sesja.</p>}

      <div className="stat-duo">
        <div className="stat-tile">
          <span className="stat-big"><Icon name="fire" size={18} /> {data.streak}</span>
          <span className="stat-label">{data.streak === 1 ? 'dzień serii' : 'dni serii'} · rekord {data.bestStreak}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-big"><FaceIcon status={data.todayStatus} size={20} /> {data.time.todayMin}<small>/{data.goalMin} min</small></span>
          <div className="goal-segments" aria-label={`Dziś ${data.time.todayMin} z ${data.goalMin} minut`}>
            {Array.from({ length: goalSegments }, (_, i) => (
              <span key={i} className={'goal-seg' + (i < goalDone ? ' on goal-' + data.todayStatus : '')} />
            ))}
          </div>
        </div>
      </div>

      <div className="stat-card cal-card">
        <div className="cal-grid cal-head">{WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}</div>
        <div className="cal-grid cal-body">
          {data.calendar.map((c) => (
            <span
              key={c.day}
              className={'cal-day' + (c.future ? ' future' : c.frozen ? ' cal-frozen' : ' cal-' + c.status) + (c.today ? ' today' : '')}
              title={c.frozen ? `${c.day}: seria uratowana` : c.day}
            />
          ))}
        </div>
        <span className="stat-label freeze-line">
          <i className="freeze-dot" /> {data.freezeAvailable ? 'ratunek serii gotowy: jeden opuszczony dzień jej nie przerwie' : 'ratunek serii użyty w tym tygodniu'}
        </span>
      </div>

      <div className="stat-card">
        <div className="stat-row">
          <span className="stat-title">{allOpen ? 'Wszystkie lekcje otwarte' : `Do lekcji ${maxLesson + 1}`}</span>
          <span className="stat-value">{allOpen ? `${lessonCount}/${lessonCount}` : goals.missing === 0 ? 'gotowe!' : `brakuje ${goals.missing}`}</span>
        </div>
        <div className="lesson-card-track"><div className="lesson-card-fill" style={{ width: (goals.ready / total) * 100 + '%' }} /></div>
        <span className="stat-label">lekcja {maxLesson} z {lessonCount} · {goals.ready}/{goals.total} kart na poziomie 3+{!allOpen && goals.missing === 0 ? ' · boss czeka' : ''}</span>
      </div>

      <div className="stat-card">
        <div className="bucket-bar" aria-label={`Nowe ${buckets.fresh}, utrwalane ${buckets.learning}, złote ${buckets.gold}`}>
          {buckets.fresh > 0 && <span className="bucket fresh" style={{ flexGrow: buckets.fresh }} />}
          {buckets.learning > 0 && <span className="bucket learning" style={{ flexGrow: buckets.learning }} />}
          {buckets.gold > 0 && <span className="bucket gold" style={{ flexGrow: buckets.gold }} />}
        </div>
        <div className="bucket-legend">
          <span><i className="bucket fresh" />nowe <b>{buckets.fresh}</b></span>
          <span><i className="bucket learning" />utrwalane <b>{buckets.learning}</b></span>
          <span><i className="bucket gold" />złote <b>{buckets.gold}</b></span>
        </div>
      </div>

      <div className="stat-duo">
        <div className="stat-tile">
          <span className={'stat-big' + (data.weekAccuracy === null ? ' none' : '')}>{data.weekAccuracy === null ? '—' : data.weekAccuracy + '%'}</span>
          <span className="stat-label">skuteczność (7 dni)</span>
        </div>
        <div className="stat-tile">
          <span className="stat-big"><Icon name="trophy" size={18} /> {data.pairsBest}</span>
          <span className="stat-label">rekord w „Parach”</span>
        </div>
      </div>

      <div className="stat-duo">
        <div className="stat-tile">
          <span className="stat-big"><Icon name="road" size={18} /> {data.roadBest}</span>
          <span className="stat-label">rekord w „Drodze”</span>
        </div>
        <div className="stat-tile" title="Pocztówki z podróży w „Drodze”: pierwszy wjazd do regionu (co 10 trafień bez stłuczki)">
          <span className="stat-big"><Icon name="star" size={18} /> {data.postcards}/{POSTCARDS.length}</span>
          <span className="stat-label">pocztówki z „Drogi”</span>
        </div>
      </div>

      <div className="stats-actions">
        <button className="btn details-btn" disabled={data.hardCount === 0} onClick={onHard}>
          <Icon name="repeat" size={14} /> Trudne ({data.hardCount})
        </button>
        <button className="btn details-btn" onClick={() => setDetails(true)}>
          <Icon name="chart" size={14} /> Szczegóły
        </button>
      </div>
    </div>
  );
}
