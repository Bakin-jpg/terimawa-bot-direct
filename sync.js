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

        console.log("3. Mengambil SEMUA data dari setiap bot (termasuk status)...");
        const allBotsData = await page.evaluate(() => {
            const botList = document.querySelectorAll('#botsList > li');
            const results = [];
            botList.forEach(li => {
                const statsEl = li.querySelector('.text-xs.text-gray-500');
                const selectEl = li.querySelector('select[onchange^="updateBotSetting"]');
                const statusEl = li.querySelector('span.inline-flex'); // Elemen untuk status

                if (statsEl && selectEl && statusEl) {
                    const statsText = statsEl.textContent.trim();
                    const botIdMatch = selectEl.getAttribute('onchange').match(/updateBotSetting\((\d+),/);
                    const sentMatch = statsText.match(/Terkirim: (\d+)/);
                    const statusText = statusEl.textContent.trim(); // "Terhubung", "Terputus", "Suspend"

                    let standardizedStatus = 'inactive'; // Default
                    if (statusText === 'Terhubung') {
                        standardizedStatus = 'active';
                    } else if (statusText === 'Suspend') {
                        standardizedStatus = 'suspended';
                    }

                    if (botIdMatch && sentMatch) {
                        results.push({
                            terimawa_bot_id: botIdMatch[1],
                            sent_count: parseInt(sentMatch[1], 10),
                            connection_status: standardizedStatus // Tambahkan status ke laporan
                        });
                    }
                }
            });
            return results;
        });

        console.log(`   ✅ Ditemukan total ${allBotsData.length} data bot untuk dilaporkan.`);

        if (allBotsData.length > 0) {
            console.log(`4. Mengirim data ke URL callback: ${SYNC_CALLBACK_URL}`);
            const response = await fetch(SYNC_CALLBACK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    secret: SYNC_SECRET,
                    bots: allBotsData // Kirim SEMUA data, jangan difilter lagi
                })
            });

            if (response.ok) {
                console.log("   ✅ Data berhasil dikirim ke server Anda.");
            } else {
                throw new Error(`Gagal mengirim data. Status: ${response.status}. Pesan: ${await response.text()}`);
            }
        } else {
            console.log("4. Tidak ada data bot untuk dikirim. Proses selesai.");
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
