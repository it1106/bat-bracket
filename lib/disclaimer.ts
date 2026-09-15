// The app's full disclaimer, in one place so the /disclaimer page and the
// top-bar modal can never drift apart.
//
// Deliberately Thai-only in both UI languages: this is a legal notice for a
// Thai audience, and a translated copy would be a second wording to keep in
// sync (and to argue about) for no benefit. The heading carries the English
// word "Disclaimer" so a non-Thai reader still knows what they are looking at.
// This is the long form of what the app already says in its title ("BAT
// Unofficial Scoreboard") and subtitle.

export const DISCLAIMER_TITLE = 'ข้อจำกัดความรับผิดชอบ (Disclaimer)'

export const DISCLAIMER_PARAGRAPHS: readonly string[] = [
  'แอปนี้เป็นแอปพลิเคชันจากบุคคลที่สาม (Third-party application) ที่พัฒนาขึ้นเพื่ออำนวยความสะดวกแก่ผู้ใช้งานโดยไม่คิดค่าใช้จ่าย และไม่ได้เป็นแอปอย่างเป็นทางการของ BAT',
  'แม้เราจะพยายามนำเสนอข้อมูลให้ถูกต้องและเป็นปัจจุบันมากที่สุด แต่ไม่สามารถรับประกันได้ว่าข้อมูลภายในแอปจะถูกต้อง ครบถ้วน หรือสอดคล้องกับข้อมูลของ BAT ในทุกกรณี',
  'ผู้พัฒนาขอสงวนสิทธิ์ไม่รับผิดชอบต่อความเสียหาย ความสูญเสีย หรือผลกระทบใด ๆ ที่เกิดจากการใช้ข้อมูลภายในแอปนี้',
  'ผู้ใช้งานควรตรวจสอบและยืนยันข้อมูลจากเว็บไซต์หรือช่องทางอย่างเป็นทางการของ BAT ทุกครั้งก่อนนำข้อมูลไปใช้งาน',
]

/** The notice tells users to verify against BAT, so link where they can. This
 *  is the same host every "official page ↗" link in the app already points at
 *  and the source all of our data is scraped from — not a guess at BAT's
 *  corporate homepage. */
export const BAT_OFFICIAL_URL = 'https://bat.tournamentsoftware.com/'
