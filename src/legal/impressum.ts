import { OPERATOR, OPERATOR_ADDRESS_LINES } from "./operator.js";
import type { LegalDocument } from "./types.js";

/**
 * Provider identification under § 5 DDG.
 *
 * Short, and most of it is a legal requirement rather than a choice. Two sections are not:
 * the catalogue attribution, which sits here because Apple, MusicBrainz and Discogs all ask to be
 * credited where a reader will actually find it and nobody scrolls a privacy policy looking
 * for it; and "Art des Angebots", which says outright that this is a private, non-commercial
 * project — the fact the rest of the document has to stay consistent with, and the reason
 * there is no Umsatzsteuer section here.
 *
 * A paragraph may contain "\n": renderers break those into lines rather than paragraphs, so
 * an address stays an address.
 */
export const IMPRESSUM: LegalDocument = {
  id: "impressum",
  version: "1.2",
  effective: "2026-09-21",
  title: { de: "Impressum", en: "Impressum" },
  lede: {
    de: "Angaben gemäß § 5 DDG",
    en: "Provider identification under § 5 DDG (German Digital Services Act)",
  },
  summary: null,
  numbered: false,
  closing: null,
  sections: [
    {
      id: "provider",
      heading: { de: "Anbieter", en: "Provider" },
      paragraphs: [
        { de: OPERATOR_ADDRESS_LINES.join("\n"), en: OPERATOR_ADDRESS_LINES.join("\n") },
      ],
    },
    {
      id: "contact",
      heading: { de: "Kontakt", en: "Contact" },
      paragraphs: [
        { de: `E-Mail: ${OPERATOR.email}`, en: `E-mail: ${OPERATOR.email}` },
        // Printed only when there is a number to print. § 5 DDG asks for quick electronic
        // contact, not for a telephone, and inventing one to fill the line would be the
        // one thing an Impressum must never do.
        ...(OPERATOR.phone === null
          ? [
              {
                de: "Eine Rufnummer wird nicht veröffentlicht. Anfragen per E-Mail werden zeitnah beantwortet.",
                en: "No telephone number is published. E-mail enquiries are answered promptly.",
              },
            ]
          : [{ de: `Telefon: ${OPERATOR.phone}`, en: `Telephone: ${OPERATOR.phone}` }]),
      ],
    },
    {
      id: "nature",
      heading: { de: "Art des Angebots", en: "Nature of the service" },
      paragraphs: [
        {
          de: "Rekordo wird von einer Privatperson als nicht-kommerzielles Projekt betrieben. Der Dienst ist kostenlos, es werden keine Entgelte erhoben und keine Waren oder Leistungen verkauft. Eine gewerbliche Tätigkeit liegt dem Angebot nicht zugrunde; ein Handelsregistereintrag und eine Umsatzsteuer-Identifikationsnummer bestehen daher nicht.",
          en: "Rekordo is run by a private individual as a non-commercial project. The service is free of charge; no fees are charged and no goods or services are sold. It is not operated as a business, and there is accordingly no commercial register entry and no VAT identification number.",
        },
      ],
    },
    {
      id: "editorial",
      heading: { de: "Verantwortlich für den Inhalt", en: "Responsible for the content" },
      paragraphs: [
        {
          de: `Nach § 18 Abs. 2 MStV: ${OPERATOR.name}, Anschrift wie oben.`,
          en: `Under § 18 (2) MStV: ${OPERATOR.name}, address as above.`,
        },
      ],
    },
    {
      id: "dispute",
      heading: { de: "Verbraucherstreitbeilegung", en: "Consumer dispute resolution" },
      paragraphs: [
        {
          de: "Wir sind nicht verpflichtet und nicht bereit, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.",
          en: "We are neither obliged nor willing to take part in dispute resolution proceedings before a consumer arbitration body.",
        },
      ],
    },
    {
      id: "liability",
      heading: { de: "Haftung für Inhalte und Links", en: "Liability for content and links" },
      paragraphs: [
        {
          de: "Für eigene Inhalte sind wir nach den allgemeinen Gesetzen verantwortlich, jedoch nicht verpflichtet, von Nutzern eingestellte Inhalte laufend auf Rechtsverstöße zu überwachen. Für verlinkte externe Seiten ist deren jeweiliger Anbieter verantwortlich; bei Bekanntwerden von Rechtsverstößen entfernen wir solche Links unverzüglich.",
          en: "We are responsible for our own content under the general laws, but are not obliged to monitor content uploaded by users for infringements. The respective provider is responsible for the content of linked external pages; where we learn of an infringement we remove such links without delay.",
        },
      ],
    },
    {
      id: "catalog",
      heading: { de: "Katalogdaten", en: "Catalogue data" },
      paragraphs: [
        {
          de: "Release- und Coverdaten stammen von Apple Music, MusicBrainz und Discogs und stehen unter den Lizenzbedingungen der jeweiligen Anbieter. Rechte an Coverabbildungen liegen bei den Rechteinhabern.",
          en: "Release and cover data come from Apple Music, MusicBrainz and Discogs and are subject to those providers' licence terms. Rights in cover artwork remain with their rights holders.",
        },
      ],
    },
  ],
};
