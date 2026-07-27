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

Dok je aplikacija u pre-v1 fazi, šema se održava kao jedna početna migracija. Posle promene te migracije postojeću razvojnu ili probnu bazu treba obrisati i napraviti ponovo; kompatibilnost sa starom probnom šemom se namerno ne održava.

Za produkciju kroz Portainer koristi se `compose.production.yaml`. Image se automatski objavljuje na
`ghcr.io/saintdelicious23/pmo-reporting:latest` nakon slanja izmena na `master` granu. U Portainer
stacku obavezno postaviti jaku vrednost za `POSTGRES_PASSWORD`.

### Portainer ažuriranje pre v1

Dok su svi podaci probni, promenjena početna migracija zahteva novu praznu PostgreSQL bazu. Postojeća
baza ne treba da se nadograđuje preko stare šeme, jer je migracija `001_initial.sql` već označena kao
izvršena.

1. Sačekati da GitHub Actions uspešno objavi novi `latest` image.
2. Sačuvati tekst trenutnog Portainer stacka, zatim ukloniti stack.
3. U Portainer meniju `Volumes` obrisati volume koji se završava sa `_reporting_postgres`.
4. Ponovo napraviti stack iz `compose.production.yaml`, sa istim `POSTGRES_PASSWORD`, i pokrenuti ga.
5. U konzoli `app` kontejnera pokrenuti `npm run db:seed` da se učitaju probni projekti.
6. Pri prvom otvaranju aplikacije napraviti administratorski nalog.

Za naredne izmene koje ne menjaju početnu šemu dovoljno je u Portaineru izabrati `Pull latest image`
i `Update the stack`; PostgreSQL volume tada ostaje netaknut.

Ako je port 4317 zauzet, u `.env` postaviti, na primer, `APP_PORT=8080`, pa aplikaciju otvoriti na `http://localhost:8080`.

Docker PostgreSQL je na hostu podrazumevano dostupan na portu 5433, kako se ne bi sudario sa eventualnom lokalnom PostgreSQL instalacijom na portu 5432. Port se po potrebi menja promenljivom `POSTGRES_PORT`.

## Razvojni režim

1. Pokrenuti PostgreSQL i kopirati `.env.example` kao `.env`.
2. Primeniti migracije komandom `npm run db:migrate`.
3. Po potrebi učitati probne podatke komandom `npm run db:seed`.
4. Pokrenuti `npm install`, zatim `npm run dev`.
5. Otvoriti adresu koju prikaže Vite.

Probni podaci se čuvaju u PostgreSQL-u i mogu se uključiti ili isključiti u aplikaciji. Seed sadrži 41 sadržajno razrađen projekat: 12 strateških projekata, 13 regulatornih obaveza i 16 operativnih unapređenja.

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

Aplikacija ima četiri gotova nivoa detalja: Sva polja, Standardno, Svedeno i Najosnovnije. Pregled `Sva polja` uvek sadrži kompletan skup raspoloživih podataka. Dugme `Prikaz` objedinjuje izbor nivoa detalja i grupisanja. Projekti mogu da se grupišu po kategorijama, po sektorima ili da se prikažu zajedno.

Meni `Podešavanja` sadrži opšte postavke, šifarnik sektora i pravila PDF izveštavanja. Sektori mogu da se dodaju, preimenuju, poređaju i izbrišu. Kada se sektor izbriše, povezani projekti ostaju bez vodećeg sektora dok im se ručno ne dodeli novi.

Prvo pokretanje prazne baze prikazuje kreiranje administratorskog naloga. Posle toga se aplikaciji
pristupa korisničkim imenom i lozinkom, a administrator nove naloge pravi u meniju `Podešavanja`.

Kod projekta se automatski dodeljuje pri kreiranju u formatu `GGGG-SEKTOR-NNN`, na primer `2026-FIN-003`. Ako vodeći sektor nije izabran, koristi se oznaka `GEN`. Jednom dodeljen kod se ne menja naknadnom promenom sektora.

Dugme `Preuzmi PDF` direktno generiše i preuzima PDF bez sistemskog print dijaloga. Ime fajla automatski dobija datum i vreme, na primer `project-portfolio_2026-07-18_14-35-22.pdf`.

## Uloge na projektu

Projekat može imati jednog ili više sponzora, vlasnika, koordinatora i izvršilaca. Najmanje jedan vlasnik je obavezan, dok su ostale uloge opcione. Za svaku ulogu može da se označi jedna glavna osoba.

Osobe se u editoru dodaju pojedinačno pritiskom na Enter ili unosom više imena razdvojenih zarezom. Ako koordinator ili izvršilac nisu posebno navedeni, podrazumevaju se vlasnici projekta; prazne opcione uloge se zato ne ponavljaju u kartičnom i tabelarnom prikazu. Nazivi uloga u prikazu automatski prelaze iz jednine u množinu kada ih ima više.

## Planirano

Faze, isporuke i detaljno praćenje izvršenja nisu deo trenutnog modela aplikacije. Ako se funkcionalnost kasnije vrati, biće uvedena kao novi kompletan workflow sa sopstvenim migracijama, uređivanjem, statusiranjem i auditom.

Otvorena UX odluka: relativni broj na kartici trenutno se nastavlja kroz kategorije, a pri grupisanju po sektorima kreće ponovo od 1 za svaki sektor. Pravilo treba ponovo potvrditi nakon praktične upotrebe oba pregleda.
