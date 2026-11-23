# Upute za rad na projektu

## GitHub sinkronizacija

Repozitorij je https://github.com/FlereImsah0/interval.git, povezan kao `origin`. Zadana grana je `main`. Ako se radi na drugoj grani, koristi njezinu odgovarajuću granu na repozitoriju `origin` i poštuj postojeća pravila za pull requestove i zaštićene grane.

1. Prije rada provjeri Git status, trenutačnu granu i odredište te dohvati novosti s repozitorija `origin`. Ako je radna kopija čista i grana može napredovati bez spajanja, primijeni promjene postupkom `git pull --ff-only`. Sačuvaj postojeće lokalne izmjene. Koristi zasebnu granu ili radnu kopiju kad je potrebna izolacija.
2. Po završetku Codex zadatka pregledaj razlike i pokreni relevantne provjere. U commit uključi samo izmjene tog zadatka i one koje je korisnik izričito uključio. Pregledaj pripremljene datoteke i izostavi tajne, privatne lokalne konfiguracije, privremene datoteke i nepotrebne generirane artefakte. Preskoči commit ako nema izmjena.
3. Prije slanja sigurno se uskladi s novim udaljenim commitovima. Pošalji dovršeni commit na odgovarajuću granu repozitorija `origin` bez dodatne potvrde za rutinski push. Za zaštićenu granu koristi postojeći tijek radne grane i pull requesta. Sačuvaj lokalni rad ako slanje zaustave konflikt, provjera, pristup ili pravila grane i javi što još treba riješiti. Izbjegni prisilni push i prepisivanje povijesti.
4. Provjeri commit na GitHubu i navedi granu i oznaku commita. Izmjene izvan Codexa sinkroniziraj kad ih korisnik uključi u zadatak ili pošalje na GitHub drugim putem.

## DeployMonster

Project `prj_df0370932c5401b31118fdc3f01166c1` hosts Interval Timer. The production hostname is `interval.fleresjourney.com`. The fallback address is https://interval-timer.hostx.bid. Deploy the contents of `web/` as a static site. There is no build command. Run `node --test` before deploying and use the base revision in `.deploymonster.json`. Record the revision returned after activation and preserve the GitHub workflow above. Keep IONOS DNS edits manual.
