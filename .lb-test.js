const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto('http://ezebat.lan:3000/leaderboards', { waitUntil: 'networkidle' })

  const dump = async (label) => {
    const cards = await page.$$eval('.lb-card', els =>
      els.map(e => ({ id: e.id, title: e.querySelector('h3')?.textContent?.slice(0,60) }))
    )
    console.log(label, '— count:', cards.length)
    cards.forEach(c => console.log('  ', c.id, '::', c.title))
  }

  await dump('Initial')
  await page.click('button.lb-tab:nth-of-type(5)')
  await page.waitForTimeout(500)
  await dump('After Ranking click')
  await page.click('button.lb-tab:nth-of-type(1)')
  await page.waitForTimeout(500)
  await dump('After Headline click')

  await browser.close()
})()
