const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const {
    TERIMAWA_USERNAME,
    TERIMAWA_PASSWORD,
    SYNC_CALLBACK_URL,
    SYNC_SECRET
} = process.env;

const BOTS_PAGE_URL = "https://app.terimawa.com/bots";

async function main() {
    let browser = null;
    console.log("🚀 Memulai bot sinkronisasi...");

    try {
        console.log("1. Meluncurkan browser dan login...");
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });
        const page = await browser.newPage();
        await page.goto("https://app.terimawa.com/login", { waitUntil: 'networkidle0' });
        await page.type('input[name="username"]', TERIMAWA_USERNAME);
        await page.type('input[name="password"]', TERIMAWA_PASSWORD);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
            page.click('button[type="submit"]')
        ]);
        console.log("   ✅ Login berhasil.");

        console.log(`2. Menavigasi ke halaman: ${BOTS_PAGE_URL}`);
        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });

        console.log("3. Mengambil data dari setiap bot...");
        const allBotsData = await page.evaluate(() => {
            const botList = document.querySelectorAll('#botsList > li');
            const results = [];
            botList.forEach(li => {
                const numberEl = li.querySelector('.text-sm.font-semibold');
                const statsEl = li.querySelector('.text-xs.text-gray-500');
                const selectEl = li.querySelector('select[onchange^="updateBotSetting"]');

                if (numberEl && statsEl && selectEl) {
                    const number = numberEl.textContent.trim();
                    const statsText = statsEl.textContent.trim();
                    const botIdMatch = selectEl.getAttribute('onchange').match(/updateBotSetting\((\d+),/);
                    const sentMatch = statsText.match(/Terkirim: (\d+)/);
                    
                    if (botIdMatch && sentMatch) {
                        results.push({
                            terimawa_bot_id: botIdMatch[1],
                            phone_number: number,
                            sent_count: parseInt(sentMatch[1], 10)
                        });
                    }
                }
            });
            return results;
        });

        console.log(`   ✅ Ditemukan total ${allBotsData.length} data bot.`);

        // --- PERUBAHAN DI SINI: MEMBUAT sync.js LEBIH PINTAR ---
        // Filter data, hanya ambil bot yang memiliki sent_count > 0
        const activeBotsData = allBotsData.filter(bot => bot.sent_count > 0);
        console.log(`    फिल्टर (Filter): Ditemukan ${activeBotsData.length} bot aktif (sent_count > 0) untuk dilaporkan.`);
        // --- AKHIR PERUBAHAN ---

        if (activeBotsData.length > 0) {
            console.log(`4. Mengirim data ke URL callback: ${SYNC_CALLBACK_URL}`);
            const response = await fetch(SYNC_CALLBACK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    secret: SYNC_SECRET,
                    bots: activeBotsData // Kirim data yang sudah difilter
                })
            });

            if (response.ok) {
                console.log("   ✅ Data berhasil dikirim ke server Anda.");
            } else {
                throw new Error(`Gagal mengirim data. Status: ${response.status}. Pesan: ${await response.text()}`);
            }
        } else {
            console.log("4. Tidak ada data bot aktif untuk dikirim. Proses selesai.");
        }

    } catch (error) {
        console.error("❌ Terjadi error pada bot sinkronisasi:", error.message);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
        console.log("🏁 Bot sinkronisasi selesai.");
    }
}

main();
