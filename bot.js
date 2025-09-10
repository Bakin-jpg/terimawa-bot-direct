const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

// --- KONFIGURASI ---
const LOGIN_PAGE_URL = "https://app.terimawa.com/login";
const SUCCESS_URL_REDIRECT = "https://app.terimawa.com/";
const BOTS_PAGE_URL = "https://app.terimawa.com/bots";
const API_URL = "https://app.terimawa.com/api/bots";

// Ambil kredensial dari GitHub Secrets
const { TERIMAWA_USERNAME, TERIMAWA_PASSWORD } = process.env;

async function getQrCode() {
    if (!TERIMAWA_USERNAME || !TERIMAWA_PASSWORD) {
        console.error("❌ Error: Pastikan TERIMAWA_USERNAME dan TERIMAWA_PASSWORD sudah diatur di GitHub Secrets.");
        process.exit(1);
    }

    let browser = null;
    let page = null;

    try {
        console.log("1. Meluncurkan browser virtual...");
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        console.log(`2. Membuka halaman login: ${LOGIN_PAGE_URL}`);
        await page.goto(LOGIN_PAGE_URL, { waitUntil: 'networkidle0', timeout: 60000 });

        console.log("3. Mengisi form login...");
        await page.type('input[name="username"]', TERIMAWA_USERNAME);
        await page.type('input[name="password"]', TERIMAWA_PASSWORD);

        console.log("4. Mengklik tombol login dan menunggu navigasi...");
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
            page.click('button[type="submit"]')
        ]);

        if (!page.url().startsWith(SUCCESS_URL_REDIRECT)) {
            throw new Error(`Gagal login. URL saat ini: ${page.url()}. Kemungkinan username/password salah.`);
        }
        
        console.log(`   ✅ Login berhasil. URL saat ini: ${page.url()}`);

        console.log(`5. Menavigasi ke halaman WhatsApp Bots: ${BOTS_PAGE_URL}`);
        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });

        console.log("6. Mengklik tombol 'Tambah WhatsApp'...");
        await page.waitForSelector('#addBotBtn', { timeout: 15000 });
        await page.click('#addBotBtn');
        
        console.log("7. Mengklik tombol 'Lanjut' dan menunggu respons API...");
        const [response] = await Promise.all([
            page.waitForResponse(res => res.url() === API_URL && res.request().method() === 'POST'),
            page.click('#addBotSubmit'),
        ]);
        
        const result = await response.json();

        if (result.error === '0' && result.msg) {
            const qr_data_url = result.msg;
            const session_name = result.session;
            console.log("\n\n✅✅✅ QR CODE BERHASIL DIAMBIL! ✅✅✅");
            console.log(`   Session ID: ${session_name}`);
            console.log("   Salin semua teks di bawah ini dan tempel di address bar browser Anda:\n");
            console.log(qr_data_url);
        } else {
            throw new Error(`Gagal mendapatkan QR Code dari API. Pesan: ${result.msg}`);
        }

    } catch (error) {
        console.error("❌ Terjadi error selama proses:", error.message);
        if (page) {
            await page.screenshot({ path: 'error_screenshot.png' });
            console.log("   Screenshot error disimpan sebagai 'error_screenshot.png'");
        }
        process.exit(1);
    } finally {
        if (browser) {
            console.log("\n8. Menutup browser...");
            await browser.close();
        }
    }
}

getQrCode();
