import type { Lang } from '@/lib/i18n'

// The site's privacy notice, in one place so the /privacy page and the footer
// link share it. Kept out of lib/i18n.ts for the same reason as the
// disclaimer: a notice reads and reviews better as one document per language.
//
// This describes what the code does. If analytics change — a new property sent
// to PostHog, session replay, an account system — update the notice with it.

export interface PrivacySection {
  heading: string
  body: string
}

export interface PrivacyText {
  /** Heading, also used for the footer link. */
  title: string
  sections: readonly PrivacySection[]
}

export const PRIVACY: Record<Lang, PrivacyText> = {
  en: {
    title: 'Privacy Notice',
    sections: [
      {
        heading: 'Who we are',
        body: 'BATMatch is an unofficial, free scoreboard for BAT tournaments. This notice explains what the site records when you use it.',
      },
      {
        heading: 'What we collect',
        body: 'When you open BATMatch, your browser creates a random visitor ID and keeps it on your device. With that ID we record which pages you view, what you open (such as a tournament, a draw or a player profile), how fast pages load, and errors that occur. We also see general information your browser sends, such as device type, browser and approximate location. If you create a custom tab, its name and search keywords are recorded with your usage data.',
      },
      {
        heading: 'What we do not collect',
        body: 'BATMatch has no accounts. We do not ask for your email address, phone number or password, and the text you type into the player search box is not recorded. Unless you put your own name in a custom tab, we do not know who you are.',
      },
      {
        heading: 'Why we collect it',
        body: 'We use this information to count visitors, to show how many people are online, to see which features are used, and to find and fix problems. We do not use it for advertising and we do not sell it.',
      },
      {
        heading: 'Who processes it',
        body: 'Usage data is processed for us by PostHog, an analytics service, on servers in the European Union. The count of visitors online is kept on BATMatch’s own server.',
      },
      {
        heading: 'What is stored on your device',
        body: 'The visitor ID and your choices (language, theme, text size, selected tournament and custom tabs) are stored in your browser. BATMatch does not use advertising cookies.',
      },
      {
        heading: 'Your choices',
        body: 'You can remove the visitor ID and your saved choices at any time by clearing this site’s data in your browser settings; a new ID is created if you visit again. Using a private window, or blocking site storage, also limits what is recorded.',
      },
      {
        heading: 'Changes',
        body: 'If this notice changes, the updated version will be posted on this page.',
      },
    ],
  },
  th: {
    title: 'ประกาศความเป็นส่วนตัว (Privacy Notice)',
    sections: [
      {
        heading: 'เราคือใคร',
        body: 'BATMatch เป็นเว็บสกอร์บอร์ดอย่างไม่เป็นทางการสำหรับรายการแข่งขันของ BAT เปิดให้ใช้งานโดยไม่คิดค่าใช้จ่าย ประกาศฉบับนี้อธิบายว่าเว็บไซต์บันทึกข้อมูลอะไรบ้างเมื่อคุณเข้าใช้งาน',
      },
      {
        heading: 'ข้อมูลที่เราเก็บ',
        body: 'เมื่อคุณเปิด BATMatch เบราว์เซอร์ของคุณจะสร้างรหัสผู้เข้าชมแบบสุ่มและเก็บไว้ในอุปกรณ์ของคุณ เราใช้รหัสนี้บันทึกว่าคุณเปิดดูหน้าใด เปิดดูอะไร (เช่น รายการแข่งขัน สายการแข่งขัน หรือโปรไฟล์นักกีฬา) หน้าเว็บโหลดเร็วแค่ไหน และมีข้อผิดพลาดอะไรเกิดขึ้น นอกจากนี้เรายังเห็นข้อมูลทั่วไปที่เบราว์เซอร์ส่งมา เช่น ประเภทอุปกรณ์ เบราว์เซอร์ และตำแหน่งโดยประมาณ หากคุณสร้างแท็บกำหนดเอง ชื่อหัวข้อและคำค้นหาของแท็บนั้นจะถูกบันทึกไปพร้อมกับข้อมูลการใช้งานด้วย',
      },
      {
        heading: 'ข้อมูลที่เราไม่เก็บ',
        body: 'BATMatch ไม่มีระบบบัญชีผู้ใช้ เราไม่ขออีเมล เบอร์โทรศัพท์ หรือรหัสผ่านของคุณ และไม่บันทึกข้อความที่คุณพิมพ์ในช่องค้นหานักกีฬา เราจึงไม่ทราบว่าคุณเป็นใคร เว้นแต่คุณจะใส่ชื่อของตัวเองไว้ในแท็บกำหนดเอง',
      },
      {
        heading: 'เราเก็บข้อมูลไปเพื่ออะไร',
        body: 'เราใช้ข้อมูลนี้เพื่อนับจำนวนผู้เข้าชม แสดงจำนวนผู้ที่กำลังออนไลน์ ดูว่าฟีเจอร์ใดมีผู้ใช้งาน และค้นหาและแก้ไขปัญหา เราไม่นำข้อมูลไปใช้เพื่อการโฆษณาและไม่ขายข้อมูลให้ผู้อื่น',
      },
      {
        heading: 'ใครเป็นผู้ประมวลผลข้อมูล',
        body: 'ข้อมูลการใช้งานประมวลผลโดย PostHog ซึ่งเป็นบริการวิเคราะห์การใช้งานเว็บไซต์ บนเซิร์ฟเวอร์ที่ตั้งอยู่ในสหภาพยุโรป ส่วนจำนวนผู้ที่กำลังออนไลน์เก็บไว้บนเซิร์ฟเวอร์ของ BATMatch เอง',
      },
      {
        heading: 'ข้อมูลที่เก็บไว้ในอุปกรณ์ของคุณ',
        body: 'รหัสผู้เข้าชมและการตั้งค่าของคุณ (ภาษา ธีม ขนาดตัวอักษร รายการแข่งขันที่เลือก และแท็บกำหนดเอง) เก็บไว้ในเบราว์เซอร์ของคุณ BATMatch ไม่ใช้คุกกี้เพื่อการโฆษณา',
      },
      {
        heading: 'ทางเลือกของคุณ',
        body: 'คุณลบรหัสผู้เข้าชมและการตั้งค่าที่บันทึกไว้ได้ทุกเมื่อ โดยล้างข้อมูลของเว็บไซต์นี้ในการตั้งค่าเบราว์เซอร์ หากกลับมาเข้าชมอีกครั้ง ระบบจะสร้างรหัสใหม่ให้ การใช้หน้าต่างแบบส่วนตัวหรือการปิดกั้นการจัดเก็บข้อมูลของเว็บไซต์ก็ช่วยจำกัดข้อมูลที่ถูกบันทึกได้เช่นกัน',
      },
      {
        heading: 'การเปลี่ยนแปลงประกาศ',
        body: 'หากมีการแก้ไขประกาศฉบับนี้ เราจะเผยแพร่ฉบับล่าสุดไว้ที่หน้านี้',
      },
    ],
  },
}

/** Language-independent heading for the document <title>, which is rendered on
 *  the server and so cannot know the reader's chosen language. */
export const PRIVACY_METADATA_TITLE = 'Privacy Notice · ประกาศความเป็นส่วนตัว'
