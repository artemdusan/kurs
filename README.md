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

## Algorytm nauki (skrót)

- Każde słowo ma globalny **poziom** (1–6). Losowanie do sesji jest ważone `1/poziom²` —
  system skupia się na słabych i nowych słowach.
- W sesji słowo znika z puli po **2 poprawnych odpowiedziach z rzędu**.
- Zmiana poziomu (awans po 2 z rzędu, spadek po błędzie) możliwa **max raz na 24 h**.
- Odmiany czasowników: przy poziomie ≤ 2 tryb **MCQ** (dystraktory = inne czasy tej samej
  osoby/liczby tego samego czasownika), wyżej — wpisywanie.
- Wpisywanie zawsze przez **mini klawiaturę ekranową** (litery odpowiedzi + 1–2 dystraktory,
  np. samogłoska z akcentem i ñ/ü); rzeczowniki mają przyciski rodzajników,
  a `el/un`, `los/unos` itd. są równoważne.
- Kolejna lekcja odblokowuje się, gdy **wszystkie** dotychczas poznane słowa osiągną
  poziom „floor” (domyślnie 2).
- Sesja trwa domyślnie 10 minut (ustawienia), opcjonalna tolerancja akcentów, TTS (es-ES).

## Synchronizacja (opcjonalna, Cloudflare — darmowy plan)

```bash
cd worker
npx wrangler d1 create kurs-db          # wpisz database_id do wrangler.toml
npx wrangler d1 execute kurs-db --file=schema.sql --remote
npx wrangler secret put ADMIN_TOKEN     # token panelu administratora
npx wrangler deploy
```

- Delty: klient wysyła tylko rekordy `updated_at > lastSync`, serwer zwraca swoje zmiany.
- Konflikty: last-writer-wins po `updated_at`; usuwanie przez soft delete (`deleted`).
- UUID słów są generowane na urządzeniu i niezmienne.
- `GET /dashboard` — panel administratora (tworzenie/usuwanie użytkowników, token ADMIN_TOKEN).
- W aplikacji: Ustawienia → adres Workera + login/hasło → „Synchronizuj teraz”.
- Adres Workera można też wstrzyknąć przy buildzie zmienną `VITE_SYNC_URL` —
  wtedy pole w ustawieniach może zostać puste (ręczny wpis ma pierwszeństwo).

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
