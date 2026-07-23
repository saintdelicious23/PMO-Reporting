# Portfolio projekata

Lokalna aplikacija za projektno i upravljačko izveštavanje.

## Docker — kompletna aplikacija

Docker pokreće aplikaciju i PostgreSQL zajedno. Migracije se automatski primenjuju pre svakog starta aplikacije.

1. Po želji kopirati `.env.example` kao `.env` i promeniti `POSTGRES_PASSWORD`.
2. Pokrenuti `docker compose up -d --build` ili `npm run docker:up`.
3. Otvoriti `http://localhost:4317`.
4. Proveriti stanje komandom `docker compose ps`.

Logovi aplikacije dostupni su kroz `npm run docker:logs`. Za zaustavljanje koristiti `npm run docker:down`.

PostgreSQL podaci ostaju u lokalnom folderu `data/postgres`. Komanda `docker compose down` ne briše podatke. Probni projekti se ne učitavaju automatski; po potrebi se mogu dodati komandom `docker compose exec app npm run db:seed`.

Za produkciju kroz Portainer koristi se `compose.production.yaml`. Image se automatski objavljuje na
`ghcr.io/saintdelicious23/pmo-reporting:latest` nakon slanja izmena na `master` granu. U Portainer
stacku obavezno postaviti jaku vrednost za `POSTGRES_PASSWORD`.

Ako je port 4317 zauzet, u `.env` postaviti, na primer, `APP_PORT=8080`, pa aplikaciju otvoriti na `http://localhost:8080`.

## Razvojni režim

1. Pokrenuti PostgreSQL i kopirati `.env.example` kao `.env`.
2. Primeniti migracije komandom `npm run db:migrate`.
3. Po potrebi učitati probne podatke komandom `npm run db:seed`.
4. Pokrenuti `npm install`, zatim `npm run dev`.
5. Otvoriti adresu koju prikaže Vite.

Probni podaci se čuvaju u PostgreSQL-u i označeni su poljem `isDemo`, pa se mogu uključiti ili isključiti u aplikaciji. Seed sadrži 41 sadržajno razrađen projekat: 12 strateških projekata, 13 regulatornih obaveza i 16 operativnih unapređenja.

## PostgreSQL režim

Docker je opcioni najjednostavniji način da cela lokalna baza ostane u `data/postgres` folderu.

1. Pokrenuti Docker Desktop.
2. Kopirati `.env.example` kao `.env`.
3. Pokrenuti `npm run db:up`.
4. Pokrenuti `npm run db:migrate`.
5. Za početni reprezentativni skup pokrenuti `npm run db:seed`.
6. Pokrenuti `npm run dev` ili nakon build-a `npm start`.

Kod lokalne PostgreSQL instalacije bazu i korisnika treba kreirati standardnim PostgreSQL alatima, zatim podesiti `DATABASE_URL` u `.env`. Preporučeni način za novu instalaciju je Docker, jer automatski kreira bazu i primenjuje migracije.

Seeder bezbedno staje ako PostgreSQL već sadrži projekte koji nisu deo probnog skupa, kako postojeći podaci ne bi bili prepisani. PostgreSQL je jedini izvor podataka.

## Podešavanja, pregledi i PDF

Aplikacija ima četiri gotova nivoa detalja: Ultradetaljno, Standardno, Svedeno i Najosnovnije. Svaki može da se prikaže po kategorijama ili kao jedna objedinjena tabela.

Meni `Podešavanja` sadrži opšte postavke, šifarnik sektora i pravila PDF izveštavanja. Sektori mogu da se dodaju, preimenuju, poređaju i izbrišu. Kada se sektor izbriše, povezani projekti ostaju bez vodećeg sektora dok im se ručno ne dodeli novi.

Dugme `Preuzmi PDF` direktno generiše i preuzima PDF bez sistemskog print dijaloga. Ime fajla automatski dobija datum i vreme, na primer `project-portfolio_2026-07-18_14-35-22.pdf`.

## Planirano

Faze, isporuke i detaljno praćenje izvršenja nisu deo trenutnog modela aplikacije. Ako se funkcionalnost kasnije vrati, biće uvedena kao novi kompletan workflow sa sopstvenim migracijama, uređivanjem, statusiranjem i auditom.
