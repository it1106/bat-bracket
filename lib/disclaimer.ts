import type { Lang } from '@/lib/i18n'

// The app's full disclaimer, in one place so the /disclaimer page, the footer
// link and the top-bar modal can never drift apart. This is the long form of
// what the app already says in its title ("BAT Unofficial Scoreboard") and its
// subtitle.
//
// Kept here rather than in lib/i18n.ts's flat TKey dictionary: that dictionary
// is for short UI labels, and splitting a legal notice across eight
// `disclaimerP1`-style keys would make the wording hard to read and easy to
// break. One paragraph array per language keeps each version reviewable as the
// document it is.

export interface DisclaimerText {
  /** Heading, also used for the ⓘ button's tooltip and the footer link. */
  title: string
  paragraphs: readonly string[]
}

export const DISCLAIMER: Record<Lang, DisclaimerText> = {
  th: {
    title: 'ข้อจำกัดความรับผิดชอบ (Disclaimer)',
    paragraphs: [
      'แอปนี้เป็นแอปพลิเคชันจากบุคคลที่สาม (Third-party application) ที่พัฒนาขึ้นเพื่ออำนวยความสะดวกแก่ผู้ใช้งานโดยไม่คิดค่าใช้จ่าย และไม่ได้เป็นแอปอย่างเป็นทางการของ BAT',
      'แม้เราจะพยายามนำเสนอข้อมูลให้ถูกต้องและเป็นปัจจุบันมากที่สุด แต่ไม่สามารถรับประกันได้ว่าข้อมูลภายในแอปจะถูกต้อง ครบถ้วน หรือสอดคล้องกับข้อมูลของ BAT ในทุกกรณี',
      'ผู้พัฒนาขอสงวนสิทธิ์ไม่รับผิดชอบต่อความเสียหาย ความสูญเสีย หรือผลกระทบใด ๆ ที่เกิดจากการใช้ข้อมูลภายในแอปนี้',
      'ผู้ใช้งานควรตรวจสอบและยืนยันข้อมูลจากเว็บไซต์หรือช่องทางอย่างเป็นทางการของ BAT ทุกครั้งก่อนนำข้อมูลไปใช้งาน',
    ],
  },
  en: {
    title: 'Disclaimer',
    paragraphs: [
      'This application is a third-party application developed solely for the convenience of users and is provided free of charge. It is not an official application of BAT.',
      'While we make every effort to ensure that the information provided in the app is accurate and up to date, we cannot guarantee that all information is complete, error-free, or fully consistent with the information published by BAT.',
      'The developer shall not be held liable for any loss, damage, or other consequences arising from the use of, or reliance on, information provided through this application.',
      'Users are strongly advised to verify all information with BAT’s official website or official communication channels before relying on or acting upon it.',
    ],
  },
}

/** Language-independent heading for the document <title>, which is rendered on
 *  the server and so cannot know the reader's chosen language. */
export const DISCLAIMER_METADATA_TITLE = 'Disclaimer · ข้อจำกัดความรับผิดชอบ'

/** The notice tells users to verify against BAT, so link where they can. This
 *  is the same host every "official page ↗" link in the app already points at
 *  and the source all of our data is scraped from — not a guess at BAT's
 *  corporate homepage. */
export const BAT_OFFICIAL_URL = 'https://bat.tournamentsoftware.com/'
