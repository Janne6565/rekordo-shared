import { HOSTING_PROCESSOR, OPERATOR, SUPERVISORY_AUTHORITY } from "./operator.js";
import type { LegalDocument } from "./types.js";

/**
 * The Datenschutzerklärung.
 *
 * It is written to be true of the app as built rather than to be safe: the local-only mode
 * really does keep the collection off the server, the catalogue lookup really does leak an
 * IP address to American organisations, and both are said plainly instead of being covered
 * by a sentence about "technical partners". If a section here stops matching the code, the
 * code is the bug or the section is — either way the version below moves.
 *
 * 1.1 (2026-09-14) caught up with what had shipped since 1.0 without the text moving: the
 * opt-in frontend diagnostics (Grafana Faro), server logs and traces leaving the cluster
 * for Grafana Cloud, the Turnstile check on the auth screens, push notifications through
 * Expo, and cover images that the device fetches straight from the Cover Art Archive and
 * Discogs. 1.0 said "no analytics or tracking" and "no cookie banner" while the web app
 * was asking for exactly that consent.
 *
 * 1.2 (2026-09-21) names Apple. Title search moved to the Apple Music catalogue and artwork
 * with it, so the search term reaches a recipient the 1.1 text did not list and the device
 * fetches covers straight from mzstatic.com. Apple does not participate in the EU-US Data
 * Privacy Framework, relying on the Global CBPR and PRP systems instead, so the transfer
 * stays on Art. 49 (1) (b) rather than moving to an adequacy decision.
 */
export const PRIVACY_POLICY: LegalDocument = {
  id: "privacy",
  version: "1.2",
  effective: "2026-09-21",
  title: { de: "Datenschutzerklärung", en: "Privacy policy" },
  lede: {
    de: "Informationen nach Art. 13 und 14 DSGVO",
    en: "Information under Art. 13 and 14 GDPR",
  },
  summary: {
    de: "Kurz gefasst: Wir speichern dein Konto und deine Sammlung, um die App zu betreiben. Keine Werbung, kein Verkauf von Daten, keine Weitergabe an Dritte zu Werbezwecken. Diagnosedaten aus dem Browser nur, wenn du ausdrücklich zustimmst. Geteilt wird nur, was du selbst freigibst.",
    en: "In short: we store your account and your collection in order to run the app. No advertising, no sale of data, no passing your data to third parties for advertising. Diagnostics from the browser only if you expressly agree. The only things shared are the ones you share yourself.",
  },
  numbered: true,
  sections: [
    {
      id: "controller",
      heading: { de: "Verantwortlicher", en: "Controller" },
      paragraphs: [
        {
          de: `${OPERATOR.name}, ${OPERATOR.street}, ${OPERATOR.city}, ${OPERATOR.email}. Ein Datenschutzbeauftragter ist nicht bestellt, da die Voraussetzungen des § 38 BDSG nicht vorliegen.`,
          en: `${OPERATOR.name}, ${OPERATOR.street}, ${OPERATOR.city}, Germany, ${OPERATOR.email}. No data protection officer has been appointed, as the conditions of § 38 BDSG are not met.`,
        },
      ],
    },
    {
      id: "data",
      heading: { de: "Welche Daten wir verarbeiten", en: "What data we process" },
      paragraphs: [
        {
          de: "Kontodaten: E-Mail-Adresse, Passwort-Hash, Anzeigename, optional ein Handle und ein Profilbild. Bei Anmeldung über Google oder Apple zusätzlich die von dort übermittelte Kennung und E-Mail-Adresse.",
          en: "Account data: e-mail address, password hash, display name, optionally a handle and a profile picture. If you sign in with Google or Apple, additionally the identifier and e-mail address those services pass on.",
        },
        {
          de: "Sammlungsdaten: deine Exemplare mit Format, Zustand, Kaufpreis, Fundort, Notizen, Bewertungen und selbst hochgeladenen Fotos, deine Wunschliste sowie Freundschaften und Freigabe-Einstellungen.",
          en: "Collection data: your copies with format, condition, purchase price, where you found them, notes, ratings and the photos you upload, your wishlist, plus friendships and sharing settings.",
        },
        {
          de: "Geräte für Benachrichtigungen (nur in der Mobil-App, wenn du Mitteilungen erlaubst): Push-Token, eine Gerätekennung, Plattform, Gerätename und wann das Gerät zuletzt gesehen wurde.",
          en: "Devices for notifications (mobile app only, if you allow notifications): push token, a device identifier, platform, device name and when the device was last seen.",
        },
        {
          de: "Technische Daten: IP-Adresse, Zeitpunkt, angefragte Ressource und Browserkennung in Server-Logs, außerdem technische Messwerte und Traces des Servers zu Fehlern und Antwortzeiten. Einwilligungsnachweise: welches Dokument in welcher Fassung wann angenommen wurde.",
          en: "Technical data: IP address, timestamp, requested resource and browser identifier in server logs, plus the server's technical metrics and traces about errors and response times. Consent records: which document, in which version, was accepted when.",
        },
        {
          de: "Diagnosedaten der Website, nur nach deiner Einwilligung: JavaScript-Fehler, Lade- und Reaktionszeiten, Browser- und Gerätetyp und die Seite, auf der etwas passiert ist. Auf der Stufe „Vollständig“ zusätzlich eine zufällige Sitzungskennung pro Tab, die Verknüpfung mit deinem Konto, besuchte Seiten, gedrückte Schaltflächen und der zugehörige Server-Trace. Titel, Notizen, Preise und Fotos gehören auf keiner Stufe dazu.",
          en: "Website diagnostics, only with your consent: JavaScript errors, load and response times, browser and device type and the page something happened on. At the “Full” level additionally a random per-tab session identifier, the link to your account, pages visited, buttons pressed and the matching server trace. Titles, notes, prices and photos are not part of it at either level.",
        },
        {
          de: "Ohne Konto bleiben Sammlungsdaten ausschließlich auf deinem Gerät. Es gibt dann keine Kopie bei uns, auch keine, die wir auf Anfrage herausgeben könnten.",
          en: "Without an account your collection data stays on your device alone. There is then no copy with us, not even one we could hand over on request.",
        },
      ],
    },
    {
      id: "legal-bases",
      heading: { de: "Rechtsgrundlagen", en: "Legal bases" },
      paragraphs: [
        {
          de: "Konto, Synchronisierung und Benachrichtigungen: Art. 6 Abs. 1 lit. b DSGVO (Vertrag). Freundesliste, Handle-Suche und öffentliche Profile: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung, jederzeit in den Freigabe-Einstellungen widerrufbar). Server-Logs, Server-Messwerte, Traces, Bot-Schutz und Missbrauchsabwehr: Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist ein sicherer und funktionierender Dienst. Einwilligungsnachweise: Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit Art. 7 Abs. 1 DSGVO.",
          en: "Account, synchronisation and notifications: Art. 6 (1) (b) GDPR (contract). Friends list, handle search and public profiles: Art. 6 (1) (a) GDPR (consent, withdrawable at any time in the sharing settings). Server logs, server metrics, traces, bot protection and abuse prevention: Art. 6 (1) (f) GDPR; our legitimate interest is a secure service that works. Consent records: Art. 6 (1) (c) in conjunction with Art. 7 (1) GDPR.",
        },
        {
          de: "Diagnosedaten der Website: Art. 6 Abs. 1 lit. a DSGVO und § 25 Abs. 1 TDDDG (Einwilligung). Die Website fragt beim ersten Besuch, nichts ist vorausgewählt, und ohne Antwort wird nichts gesendet. Du kannst die Stufe jederzeit mit Wirkung für die Zukunft in den Einstellungen unter Datenschutz ändern oder auf „Nichts“ stellen.",
          en: "Website diagnostics: Art. 6 (1) (a) GDPR and § 25 (1) TDDDG (consent). The website asks on the first visit, nothing is preselected, and nothing is sent without an answer. You can change the level, or set it to “Nothing”, at any time with effect for the future in Settings under Privacy.",
        },
        {
          de: "Alles andere, was wir auf deinem Gerät speichern (Anmeldung, lokale Sammlung, Einstellungen und deine Antwort zur Diagnose), ist für den Betrieb der App unbedingt erforderlich und daher nach § 25 Abs. 2 Nr. 2 TDDDG einwilligungsfrei. Werbe-Cookies oder Werbe-Tracking setzen wir nicht ein.",
          en: "Everything else we store on your device (sign-in, the local collection, settings and your answer on diagnostics) is strictly necessary for the app to work and therefore needs no consent under § 25 (2) no. 2 TDDDG. We use no advertising cookies and no advertising tracking.",
        },
      ],
    },
    {
      id: "recipients",
      heading: { de: "Empfänger und Auftragsverarbeiter", en: "Recipients and processors" },
      paragraphs: [
        {
          de: `Hosting: ${HOSTING_PROCESSOR.name}, ${HOSTING_PROCESSOR.address}. Server und Foto-Speicher stehen in Deutschland; die Verarbeitung erfolgt auf Grundlage eines Auftragsverarbeitungsvertrags nach Art. 28 DSGVO.`,
          en: `Hosting: ${HOSTING_PROCESSOR.name}, ${HOSTING_PROCESSOR.address}. Servers and photo storage are located in Germany; processing takes place under a data processing agreement pursuant to Art. 28 GDPR.`,
        },
        {
          de: "Monitoring: Server-Logs, Server-Messwerte und Traces sowie die Diagnosedaten der Website, soweit du eingewilligt hast, verarbeitet Raintank, Inc. (Grafana Labs), USA, als Auftragsverarbeiter nach Art. 28 DSGVO. Gespeichert wird in einem Rechenzentrum in Frankfurt am Main. Weil das Unternehmen in den USA sitzt, ist ein Zugriff von dort nicht ausgeschlossen; Grafana Labs ist nach dem EU-US Data Privacy Framework zertifiziert (Art. 45 DSGVO), ergänzend gelten die Standardvertragsklauseln. Diagnosedaten der Website laufen über unseren eigenen Server, der deine IP-Adresse vor der Weiterleitung entfernt.",
          en: "Monitoring: server logs, server metrics and traces, as well as website diagnostics where you have consented, are processed by Raintank, Inc. (Grafana Labs), USA, as a processor under Art. 28 GDPR. Storage is in a data centre in Frankfurt am Main. Because the company is based in the USA, access from there cannot be ruled out; Grafana Labs is certified under the EU-US Data Privacy Framework (Art. 45 GDPR), with the standard contractual clauses in addition. Website diagnostics pass through our own server, which removes your IP address before forwarding them.",
        },
        {
          de: "Bot-Schutz: Bei Registrierung, Anmeldung und Passwort-Zurücksetzen prüft Cloudflare Turnstile (Cloudflare, Inc., USA), ob ein Mensch die Anfrage stellt. Dabei verarbeitet Cloudflare deine IP-Adresse und technische Merkmale von Browser und Gerät. Grundlage ist Art. 6 Abs. 1 lit. f DSGVO; Cloudflare ist nach dem EU-US Data Privacy Framework zertifiziert.",
          en: "Bot protection: when you register, sign in or reset a password, Cloudflare Turnstile (Cloudflare, Inc., USA) checks that a person is making the request. Cloudflare processes your IP address and technical characteristics of your browser and device for this. The basis is Art. 6 (1) (f) GDPR; Cloudflare is certified under the EU-US Data Privacy Framework.",
        },
        {
          de: "Katalogabfragen: bei der Titelsuche wird der Suchbegriff über unseren Server an Apple Inc. (Apple-Music-Katalog), USA, übermittelt. Beim Barcode-Scan und beim Nachschlagen einer bestimmten Pressung geht er stattdessen über unseren Server an die MetaBrainz Foundation (MusicBrainz, USA) und Discogs / Zink Media (USA). Cover-Bilder lädt dein Gerät direkt von Apple (mzstatic.com), vom Cover Art Archive (Internet Archive, USA) und von Discogs, sobald sie angezeigt werden; dabei erfahren diese Anbieter deine IP-Adresse. Grundlage ist Art. 6 Abs. 1 lit. b DSGVO, die Übermittlung in die USA stützt sich auf Art. 49 Abs. 1 lit. b DSGVO. Wer das vermeiden möchte, legt Exemplare von Hand und ohne Katalog-Cover an.",
          en: "Catalogue lookups: when you search by title, the search term is passed via our server to Apple Inc. (Apple Music catalogue), USA. When you scan a barcode or look up a particular pressing, it goes via our server to the MetaBrainz Foundation (MusicBrainz, USA) and Discogs / Zink Media (USA) instead. Your device loads cover images directly from Apple (mzstatic.com), the Cover Art Archive (Internet Archive, USA) and Discogs whenever they are shown, and those providers learn your IP address in doing so. The basis is Art. 6 (1) (b) GDPR; the transfer to the USA relies on Art. 49 (1) (b) GDPR. If you would rather avoid this, enter copies by hand and without catalogue covers.",
        },
        {
          de: "Push-Benachrichtigungen (Mobil-App): Wir senden sie über den Push-Dienst von 650 Industries, Inc. (Expo), USA, der sie an Apple (Apple Push Notification Service) oder Google (Firebase Cloud Messaging) weitergibt. Übermittelt werden Push-Token und Inhalt der Mitteilung. Mitteilungen lassen sich in der App stummschalten oder in den Systemeinstellungen abschalten.",
          en: "Push notifications (mobile app): we send them through the push service of 650 Industries, Inc. (Expo), USA, which hands them to Apple (Apple Push Notification Service) or Google (Firebase Cloud Messaging). The push token and the content of the notification are transmitted. Notifications can be muted in the app or switched off in the system settings.",
        },
        {
          de: "E-Mail-Versand (Bestätigung der Adresse, Passwort zurücksetzen): über unseren eigenen Mail-Dienst auf derselben Infrastruktur. Anmeldung über Google oder Apple: dabei erfährt der jeweilige Anbieter, dass du dich bei Rekordo anmeldest. Keine Werbedienste, keine Werbeprofile, kein Verkauf von Daten.",
          en: "E-mail delivery (address confirmation, password resets): through our own mail service on the same infrastructure. Signing in with Google or Apple: the provider concerned learns that you are signing in to Rekordo. No advertising services, no advertising profiles, no sale of data.",
        },
      ],
    },
    {
      id: "retention",
      heading: { de: "Speicherdauer", en: "Retention" },
      paragraphs: [
        {
          de: "Kontodaten und Sammlungsdaten bis zur Löschung des Kontos, danach längstens 30 Tage in Backups. Server-Logs, Traces und Diagnosedaten der Website 14 Tage. Geräte für Benachrichtigungen, bis du dich auf dem Gerät abmeldest oder das Konto löschst. Einwilligungsnachweise so lange, wie das Konto besteht: Sie werden zusammen mit dem Konto gelöscht, weil ein Nachweis, der niemanden mehr betrifft, nur noch personenbezogene Daten ohne Zweck wäre.",
          en: "Account and collection data until the account is deleted, then for at most 30 days in backups. Server logs, traces and website diagnostics for 14 days. Devices for notifications until you sign out on the device or delete the account. Consent records for as long as the account exists: they are deleted along with it, because a record of consent that no longer concerns anyone would be personal data with no purpose left.",
        },
        {
          de: "Nach der Löschung bleiben geteilte Inhalte nicht bei anderen Nutzern zurück: Freigaben werden mit dem Konto entfernt, nicht nur unsichtbar geschaltet.",
          en: "After deletion, shared content does not linger with other users: shares are removed with the account rather than merely hidden.",
        },
      ],
    },
    {
      id: "rights",
      heading: { de: "Deine Rechte", en: "Your rights" },
      paragraphs: [
        {
          de: "Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21), insbesondere gegen Verarbeitungen auf Grundlage berechtigter Interessen. Eine erteilte Einwilligung kannst du jederzeit mit Wirkung für die Zukunft widerrufen (Art. 7 Abs. 3).",
          en: "Access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction (Art. 18), data portability (Art. 20) and objection (Art. 21), in particular to processing based on legitimate interests. Consent you have given can be withdrawn at any time with effect for the future (Art. 7 (3)).",
        },
        {
          de: "Auskunft, Berichtigung, Export, Widerruf und Löschung erledigst du direkt in der App unter Deine Daten; die Einwilligung zur Diagnose in den Einstellungen unter Datenschutz. Was sich nicht automatisch erledigen lässt, beantworten wir innerhalb eines Monats nach Art. 12 Abs. 3 DSGVO.",
          en: "Access, rectification, export, withdrawal and deletion are all handled directly in the app under Your data; consent to diagnostics in Settings under Privacy. Anything that cannot be handled automatically is answered within one month, as required by Art. 12 (3) GDPR.",
        },
        {
          de: `Beschwerderecht: ${SUPERVISORY_AUTHORITY.name}, ${SUPERVISORY_AUTHORITY.address}.`,
          en: `Right to complain: ${SUPERVISORY_AUTHORITY.name}, ${SUPERVISORY_AUTHORITY.address}.`,
        },
      ],
    },
  ],
  closing: {
    de: "Eine automatisierte Entscheidungsfindung oder ein Profiling nach Art. 22 DSGVO findet nicht statt.",
    en: "No automated decision-making or profiling within the meaning of Art. 22 GDPR takes place.",
  },
};
