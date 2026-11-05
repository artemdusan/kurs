# Kurs hiszpańskiego — PWA

Aplikacja PWA (offline-first, mobile-first) do nauki hiszpańskiego: 100 lekcji od A0 do B1.
Dane kursu leżą w `indeks.json` + `lekcje/`, aplikacja w `app/`, serwer synchronizacji w `worker/`.

## Uruchomienie aplikacji

```bash
cd app
npm install
npm run dev        # dev server
npm run build      # produkcyjny build PWA (dist/)
```

Skrypt `scripts/copy-data.mjs` kopiuje dane kursu do `app/public/data` przed dev/build.

## Algorytm nauki

- Każda karta (w tym osobna odmiana czasownika) ma poziom **1–10**.
- Poprawna odpowiedź podnosi poziom o 1, najwyżej raz w **lokalnym dniu kalendarzowym**.
  Po północy można awansować ponownie, bez czekania pełnych 24 godzin.
- Błąd na poziomie 2–5 obniża poziom o 1; na poziomie 6–10 obniża go do 5,
  o ile tego dnia nie wykorzystano już zmiany. Błąd na poziomie 1 blokuje awans do północy.
  Poprawna odpowiedź na poziomie 10 też wykorzystuje zmianę na ten dzień.
- Kolejna lekcja odblokowuje się po sesji, gdy **wszystkie karty wszystkich
  dotychczas odblokowanych lekcji mają poziom co najmniej 3**. Otwarte lekcje
  nie zamykają się po późniejszym spadku poziomu.
- Pula liczy 25 kart: przy dostatecznej liczbie kart 12 miejsc przypada na
  poziom 1 (najdawniej widziane), 13 na powtórki. Wybór kolejnego pytania daje
  obu grupom po 50% szans. Powtórki są ważone `1/poziom²` zarówno przy doborze
  puli, jak i pytania. Niedobór jednej grupy uzupełnia druga.
- Jedna poprawna odpowiedź usuwa kartę z puli bieżącej sesji.
- Odmiany na poziomach 1–2: wybór odpowiedzi; wyżej: wpisywanie.
- Rzeczowniki: osobny wybór rodzajnika; `el/un`, `la/una` itd. są równoważne.
- Tolerancja akcentów działa do poziomu 5; od 6 odpowiedź musi zawierać akcenty.
- Czas widocznej sesji jest zapisywany co sekundę. Zamknięcie karty nie gubi
  całej sesji, ale nagłe zakończenie procesu może utracić ostatni niezapisany tick.
  Odpowiedzi i czas po północy trafiają do nowego dnia; ukończenie sesji do dnia jej rozpoczęcia.
- Wykres statystyk pokazuje awanse/spadki z 7 dni. Jeden spadek 10 → 5 liczy
  się jako jedno zdarzenie. Migracyjne ograniczenie poziomu nie jest spadkiem.

## Aktualizacja z wersji 0.3 / synchronizacja v2

Nowa wersja migruje ustawiony próg na 3 i ogranicza poziomy >10. Identyfikatory
kart, liczniki odpowiedzi i odblokowane lekcje pozostają zachowane. Historia
awansów/spadków zaczyna się od migracji; wcześniejsze dni mają oznaczenie braku danych.
Dawne dzienne sumy UTC pozostają pod oryginalnymi datami, bo bez historii zdarzeń
nie można ich wiarygodnie przeliczyć na czas lokalny. Utraconych wcześniej danych
z konfliktów synchronizacji nie da się odzyskać z samych sum.

### Kolejność wdrożenia

1. Wykonać kopię bazy D1 i zsynchronizować urządzenia na dotychczasowej wersji.
2. Uruchomić `npx wrangler d1 execute kurs-db --file=schema.sql --remote` w `worker/`.
   Skrypt dodaje `daily_counters`; nie usuwa starych tabel ani rekordów.
3. Wdrożyć Worker, a następnie aplikację Pages. Odświeżyć aplikację na wszystkich urządzeniach.
   Worker v2 odrzuca synchronizację starej aplikacji (HTTP 409); nowa aplikacja wykrywa
   stary serwer i nie uznaje takiej odpowiedzi za udaną synchronizację.
4. Sprawdzić synchronizację na urządzeniach. Do czasu aktualizacji nauka nadal zapisuje się lokalnie.

Rollback aplikacji do starej wersji nie jest automatyczny: IndexedDB ma nową wersję,
która chroni przed zapisami starego klienta. Zachować kopię D1 i nie usuwać lokalnej bazy.

### Zasady synchronizacji

- Klient wysyła zmienione postępy i liczniki partiami do 25 rekordów. Potwierdza
  dokładnie wysłany stan, więc odpowiedzi zapisane podczas żądania czekają na następny sync.
- Serwer zwraca pełny zestaw postępów i liczników dla użytkownika. Przy maksymalnie
  3085 kartach eliminuje to błędy kursora czasowego przy późnych wysyłkach offline.
- Postępy nadal rozstrzygane są według czasu ostatniego zapisu (LWW). Równoległe
  odpowiedzi na tę samą kartę na dwóch urządzeniach nie są odtwarzane jako historia;
  nowszy stan karty wygrywa. Zegary urządzeń powinny być ustawiane automatycznie.
- Statystyki są niezależnymi, rosnącymi licznikami urządzenie/dzień. Serwer scala
  każdy licznik przez maksimum, a różne urządzenia sumuje. Retries są idempotentne.
- Stare sumy są wspólną bazą `legacy`, aby ich nie dublować przy migracji urządzeń.
- Materiały kursu pochodzą z wersjonowanych plików aplikacji, nie z synchronizacji
  użytkownika; stare kopie słówek na serwerze nie nadpisują nowych treści.
- JSON wszystkich lekcji jest objęty precache z rewizjami Workbox. Nowy zestaw
  jest pobierany przy instalacji wersji PWA i działa offline. `?v=8` omija stary
  cache danych podczas przejścia ze starszej wersji.

Pierwsza konfiguracja Workera:

```bash
cd worker
npx wrangler d1 create kurs-db          # wpisz database_id do wrangler.toml
npx wrangler d1 execute kurs-db --file=schema.sql --remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

W aplikacji: Ustawienia → adres Workera + login/hasło → „Synchronizuj teraz”.
Adres można też wstrzyknąć przy buildzie jako `VITE_SYNC_URL`.
`GET /dashboard` udostępnia panel administratora chroniony `ADMIN_TOKEN`.

### Testy

```bash
cd app
npm ci
npm test                 # IndexedDB, migracja, daty/DST, synchronizacja w Miniflare z D1
npm run build
npm run test:browser     # Chromium/Playwright: aktualizacja starej PWA i tryb offline
node scripts/check-content.mjs b2b715a10bed0cb8f276b2427dc427f79599c946
```

Test przeglądarkowy używa `/usr/bin/chromium`, `CHROMIUM_PATH` lub przeglądarki
zainstalowanej przez `npx playwright install chromium`. Działa na testowej bazie,
bez połączenia z produkcyjnym Workerem.

### Przypomnienia push (opcjonalne)

Buźka w nagłówku aplikacji pokazuje status dnia: **zielona** — dzienny cel minut
osiągnięty (Ustawienia → „Dzienny cel nauki”), **żółta** — była nauka, ale krócej
niż cel (dzień i tak liczy się do streaka), **czerwona** — dziś jeszcze nic.

Worker o **19:00 czasu polskiego** (cron 17:00 i 18:00 UTC + sprawdzenie strefy
Europe/Warsaw) wysyła powiadomienie push z przypomnieniem — tylko wtedy, gdy
danego dnia nie było żadnej sesji. Konfiguracja:

```bash
cd worker
npx wrangler d1 execute kurs-db --file=schema.sql --remote  # dodaje tabelę push_subscriptions
npx web-push generate-vapid-keys
npx wrangler secret put VAPID_PUBLIC_KEY    # Public Key z poprzedniej komendy
npx wrangler secret put VAPID_PRIVATE_KEY   # Private Key
npx wrangler secret put VAPID_SUBJECT       # np. mailto:twoj@email.pl
npx wrangler deploy                          # rejestruje też crony z wrangler.toml
```

W aplikacji: Ustawienia → Przypomnienia → „Włącz przypomnienia” (wymaga
skonfigurowanej synchronizacji; na iOS aplikacja musi być zainstalowana na
ekranie głównym). Push jest bez payloadu — treść powiadomienia jest w
service workerze (`app/public/push-sw.js`), więc nie trzeba szyfrowania.

## Hosting aplikacji (Cloudflare Pages)

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → połącz repo.
2. Build command: `cd app && npm install && npm run build`, output directory: `app/dist`.
3. W ustawieniach projektu Pages dodaj zmienną środowiskową buildu
   `VITE_SYNC_URL = https://twoj-worker.workers.dev` (adres z `wrangler deploy`).

## Format lekcji

Każda lekcja (`lekcje/*.json`): 1 czasownik (z 18 formami: present/preterite/future ×
6 osób; czasowniki bezosobowe jak *llover* mają tylko 3), 10 rzeczowników, 2 przymiotniki.
Zdania przykładowe w notacji cloze `[słowo_hiszpańskie::tłumaczenie_polskie]` + pełne
tłumaczenie (rzeczowniki/przymiotniki po 3, formy czasowników po 1). Polskie tłumaczenia
zawsze w formie męskiej. Słowa wieloznaczne to osobne rekordy z hintem w nawiasie.
