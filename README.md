# Sopralluoghi

App web per documentare sopralluoghi: per ogni voce da verificare (ad esempio "Rack audio", "Cablaggi") si scrivono
le note e si scattano le foto con la loro didascalia, sempre insieme. Alla fine si genera un report in PDF.

## Come funziona
- Si crea un sopralluogo (nome del luogo, data), poi si aggiungono le **voci**.
- In ogni voce: una **nota**, una **sala** (menù a tendina) e le **foto** con didascalia. Nota e foto restano
  legate alla voce, così nel report non si perde mai a cosa si riferiscono.
- Il **report** raccoglie tutte le voci e si salva in **PDF**; può essere condiviso via email.
- Nella pagina **Impostazioni** si scelgono l'intestazione dei report, l'email e l'elenco delle voci da proporre.

## Dati e privacy
Tutto resta nel telefono (archivio del browser). L'app non ha un server e non carica nulla online: foto, note e
impostazioni non lasciano mai il dispositivo.

## Uso
Aprire l'indirizzo dell'app con Chrome su Android e scegliere "Installa app": dopo il primo caricamento funziona
anche senza connessione.

## Tecnica
HTML, CSS e JavaScript senza framework. PDF creati con [jsPDF](https://github.com/parallax/jsPDF) (licenza MIT).
