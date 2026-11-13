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

## Co widać w aplikacji

- **Ekran główny** ma jedną kartę lekcji (numer, temat, postęp i ile kart dzieli od
  kolejnej lekcji, a pod spodem wyzwanie dnia), materiał lekcji i przycisk sesji.
  Nagłówek to jeden pasek stanu: seria, minuty dziś względem celu i poziom gracza
  z zapasem serc i jokerów na bossa; dotknięcie otwiera Statystyki (tam ranga i liczby XP).
- **Pierwsze uruchomienie** zaczyna się od krótkiego powitania i prowadzi prosto do
  pierwszej sesji.
- **Boss** (`Boss.jsx`, zasady w `engine/boss.js`): gdy wszystkie karty mają poziom 3,
  przycisk sesji zmienia się w „Walcz z bossem”. To jedyna droga do kolejnej lekcji.
  Boss szykuje atak (pasek czasu), a pytania są szybkie i pochodzą głównie z ukończonej
  lekcji: tłumaczenie z 4 opcji, forma czasownika, rodzajnik. Dobra odpowiedź zabiera
  1 punkt życia, szybka (pierwsze 35% czasu) to cios krytyczny za 2. Błąd albo spóźnienie
  kończy walkę, chyba że masz serce za rangę (ratuje przed jednym błędem i dopiero wtedy
  się zużywa). Boss nie ma serc na start; joker 50/50 za poziom usuwa złe odpowiedzi. Ostatni punkt zabiera „cios kończący”: wpisanie słowa z lekcji.
  Pięć rodzajów bossów zmienia się co lekcję: Strażnik, Błyskawica (mniej czasu),
  Tarczownik (tarcza wraca po błędzie), Wampir (leczy się na błędach), Kameleon
  (pytania w odwrotną stronę). Walka nie zmienia poziomów kart, liczy się do dnia nauki.
- **Lista lekcji** pokazuje całą ścieżkę kursu z podziałem na poziomy; zamknięte lekcje
  są widoczne, ale nieaktywne.
- **Pikselowa mapa** (`PixelMap`, nad listą lekcji): 100 pól w kształcie półwyspu, jedno
  na lekcję. Otwarte pola zielenieją wraz z postępem, w pełni opanowane są złote.
- **Szybka sesja 2 min** i **Pary na czas** są pod ręką obok pełnej sesji, a po
  przytrzymaniu ikony aplikacji działają jako skróty (`/?start=quick`, `/?start=pairs`).
- **Nowe słowo** najpierw się przedstawia (słowo, zdanie, lektor), dopiero potem
  pada pytanie. Formy odmiany zaczynają od wyboru z trzech opcji, więc prezentacji nie mają.
- **Po błędzie** widać własną odpowiedź z zaznaczonymi znakami, które nie pasują.
  Po każdej odpowiedzi lektor czyta całe zdanie.
- **Poziom karty** to 5 kropek: poziomy 1–5 zapełniają je kolorami, poziomy 6–10
  zapełniają te same kropki drugi raz na złoto.
- **Podsumowanie sesji** ma listę słów do poprawki, liczbę awansów i kamienie milowe
  (złote karty, seria, otwarte lekcje, poprawne odpowiedzi) — każdy ogłaszany raz.
- **Pary na czas**: 60 sekund łączenia polskich słów z hiszpańskimi, seria bezbłędnych
  par mnoży punkty (do ×5). Wyczyszczona plansza dolicza 3 sekundy, od drugiej planszy
  jedno hiszpańskie słowo jest złote (para za ×3), a seria 5 par włącza „gorączkę”. Gra nie zmienia poziomów kart, ale jej czas i odpowiedzi
  liczą się do dnia nauki, więc podtrzymuje serię. Rekord jest zapisany lokalnie.
- **Statystyki** mieszczą się na jednym ekranie telefonu: seria, dzisiejszy cel,
  kalendarz 5 tygodni, droga do kolejnej lekcji, stan talii (nowe / utrwalane / złote),
  skuteczność z 7 dni. Wykres awansów i pełny rozkład poziomów są pod „Szczegóły”.
- **Cząsteczki** (`app/src/particles.js`): pikselowe wybuchy przy dobrej odpowiedzi,
  większe przy awansie (złote od poziomu 6), unoszące się punkty w „Parach”, deszcz
  konfetti przy nowej lekcji, kamieniu milowym, rekordzie i sesji bez błędu. Wyłączają
  się przy systemowym „ogranicz ruch”.
- **Dźwięki 8-bit** (`app/src/sound.js`, Web Audio, bez plików): dobra odpowiedź, błąd,
  awans, fanfara. Wyłącznik w Ustawieniach.
- **Seria w sesji**: licznik poprawnych odpowiedzi z rzędu (×N) podkręca efekty i ton dźwięku.
- **Zadania ze słuchu**: dla kart od poziomu 4 co czwarte pytanie jest dyktandem — lektor
  czyta słowo, polska podpowiedź i zdanie są ukryte. „Nie mogę teraz słuchać” zamienia
  zadanie w zwykłe i wyłącza dyktanda do końca sesji. Wyłącznik w Ustawieniach.
- **Droga** (`Road.jsx`): jazda w pseudo-3D rysowana na canvasie 2D. Lewy pas to „el”,
  prawy „la”; wjeżdżasz w bramkę pasującą do rzeczownika. Trafienia przyspieszają jazdę,
  pierwsza stłuczka kończy grę (bez żyć). Punkty jak w „Parach”, skrót `/?start=road`.
- **Ranga i nagrody za poziom**: co 5 poziomów nowa ranga (Turista, Viajero, Estudiante,
  Vecino, Hablante, Nativo, potem Nativo z gwiazdkami bez końca). Każdy poziom daje jokera
  50/50 na bossa (zapas do 2, raz na walkę: zostają dobra i jedna zła odpowiedź). Nowa ranga
  daje dodatkowo serce na bossa (zapas 1, zużywa się dopiero, gdy uratuje walkę) i nowy lakier
  auta w „Drodze”. Przy pełnym zapasie nagroda zamienia się w 100 XP. Zapasy są zapisane lokalnie.
- **Poziom gracza (XP)**: 10 XP za poprawną odpowiedź, 20 za awans karty, 50 za sesję,
  100 za wyzwanie dnia. Liczony z liczników dni, więc synchronizuje się razem z nimi
  (bonus za wyzwania jest zapisany tylko lokalnie).
- **Wyzwanie dnia**: jedno zadanie wybierane z daty (awanse, poprawne odpowiedzi, minuty,
  wynik w grze).
- **Trudne słowa** (Statystyki → Trudne): karty z co najmniej dwiema pomyłkami, od
  najwyższego odsetka błędów, z powtórką bez limitu czasu.
- **Ratunek serii**: jeden opuszczony dzień nie przerywa serii, jeśli od poprzedniego
  ratunku minęło 7 dni nauki. Wynika z samej historii dni, więc jest taki sam na każdym
  urządzeniu; w kalendarzu uratowany dzień jest niebieski. Przypomnienie Workera o 21:00
  nadal patrzy tylko na wczorajszą naukę.
- **Znacznik na ikonie** aplikacji jest widoczny, dopóki dzienny cel nie jest zrobiony
  (Badging API; działa w zainstalowanej PWA).

## Algorytm nauki

- Każda karta (w tym osobna odmiana czasownika) ma poziom **1–10**.
- Poprawna odpowiedź podnosi poziom o 1, najwyżej raz w **lokalnym dniu kalendarzowym**.
  Po północy można awansować ponownie, bez czekania pełnych 24 godzin.
- Błąd na poziomie 2–5 obniża poziom o 1; na poziomie 6–10 obniża go do 5,
  o ile tego dnia nie wykorzystano już zmiany. Błąd na poziomie 1 blokuje awans do północy.
  Poprawna odpowiedź na poziomie 10 też wykorzystuje zmianę na ten dzień.
- Gdy **wszystkie karty wszystkich dotychczas odblokowanych lekcji mają poziom
  co najmniej 3**, pojawia się boss; kolejną lekcję otwiera wygrana z nim.
  Zwykła sesja, szybka sesja i gry lekcji nie otwierają; walka nie zmienia poziomów kart. Otwarte lekcje
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
  jest pobierany przy instalacji wersji PWA i działa offline. `?v=9` omija stary
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
npm run test:browser     # Chromium/Playwright: aktualizacja starej PWA, tryb offline, gra
node scripts/check-content.mjs b2b715a10bed0cb8f276b2427dc427f79599c946
```

Test przeglądarkowy używa `/usr/bin/chromium`, `CHROMIUM_PATH` lub przeglądarki
zainstalowanej przez `npx playwright install chromium`. Działa na testowej bazie,
bez połączenia z produkcyjnym Workerem.

### Przypomnienia push (opcjonalne)

Buźka w nagłówku aplikacji pokazuje status dnia: **zielona** — dzienny cel minut
osiągnięty (Ustawienia → „Dzienny cel nauki”), **żółta** — była nauka, ale krócej
niż cel (dzień i tak liczy się do streaka), **czerwona** — dziś jeszcze nic.

Worker wysyła powiadomienia push tylko wtedy, gdy danego dnia nie było jeszcze nauki
(czas polski; cron działa w UTC dla czasu letniego i zimowego, kod sprawdza strefę
Europe/Warsaw):

- **19:00** — dziś jeszcze bez nauki,
- **21:00** — nadal nic, a wczoraj była nauka, czyli seria wygaśnie o północy,
- **8:00** — poranna zachęta (domyślnie wyłączona).

Każde z nich włącza się osobno w Ustawieniach → Przypomnienia; wybór trafia do
Workera (`POST /push/prefs`, tabela `meta`, bez zmian w schemacie bazy). Konfiguracja:

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
ekranie głównym). Push jest bez payloadu — treść powiadomienia dobiera service
worker według godziny (`app/public/push-sw.js`), więc nie trzeba szyfrowania.

Zmiana przypomnień wymaga ponownego wdrożenia Workera (`npx wrangler deploy` albo
automatyczne wdrażanie z GitHuba: Workers & Pages → `kurs-sync` → Settings → Build,
katalog `worker`). Aplikacja działa też ze starszym Workerem — wtedy przychodzi tylko
przypomnienie o 19:00.

## Hosting aplikacji (Cloudflare Pages)

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → połącz repo.
2. Build command: `cd app && npm install && npm run build`, output directory: `app/dist`.
3. W ustawieniach projektu Pages dodaj zmienną środowiskową buildu
   `VITE_SYNC_URL = https://twoj-worker.workers.dev` (adres z `wrangler deploy`).

## Format lekcji

Każda lekcja (`lekcje/*.json`): 1 czasownik (z 18 formami: present/preterite/future ×
6 osób; czasowniki bezosobowe jak *llover* mają tylko 3), 10 rzeczowników, 2 przymiotniki.
Hasło może się powtórzyć tylko w innym znaczeniu (inne polskie tłumaczenie); jedna rama
zdania może wystąpić najwyżej 12 razy w całym kursie — pilnuje tego `check-content.mjs`.
Zdania przykładowe w notacji cloze `[słowo_hiszpańskie::tłumaczenie_polskie]` + pełne
tłumaczenie (rzeczowniki/przymiotniki po 3, formy czasowników po 1). Polskie tłumaczenia
zawsze w formie męskiej. Słowa wieloznaczne to osobne rekordy z hintem w nawiasie.
