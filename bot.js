const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

// --- KONFIGURASI ---
const LOGIN_PAGE_URL = "https://app.terimawa.com/login";
const SUCCESS_URL_REDIRECT = "https://app.terimawa.com/";
const BOTS_PAGE_URL = "https://app.terimawa.com/bots";
const API_URL = "https://app.terimawa.com/api/bots";

// Ambil variabel dari GitHub Actions
const {
    TERIMAWA_USERNAME,
    TERIMAWA_PASSWORD,
    CALLBACK_URL,
    CALLBACK_SECRET,
    ACTION,
    BOT_ID
} = process.env;

// --- FUNGSI UTAMA (ROUTER) ---
async function main() {
    if (!TERIMAWA_USERNAME || !TERIMAWA_PASSWORD) {
        console.error("❌ Error: Kredensial (TERIMAWA_USERNAME, TERIMAWA_PASSWORD) tidak diatur di GitHub Secrets.");
        process.exit(1);
    }

    console.log(`🚀 Menjalankan aksi: ${ACTION || 'Tidak ada aksi'}`);

    switch (ACTION) {
        case 'get_qr':
            await getQrCode();
            break;
        case 'start_blast':
            await controlBlast(BOT_ID, 'start');
            break;
        case 'stop_blast':
            await controlBlast(BOT_ID, 'stop');
            break;
        default:
            console.error(`❌ Aksi tidak dikenal atau tidak disediakan: ${ACTION}`);
            process.exit(1);
    }
}

// --- FUNGSI LOGIN (Digunakan bersama) ---
async function loginAndGetPage(browser) {
    const page = await browser.newPage();
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
    return page;
}


// --- FUNGSI UNTUK MENGAMBIL QR CODE ---
async function getQrCode() {
    if (!CALLBACK_URL || !CALLBACK_SECRET) {
        console.error("❌ Error: CALLBACK_URL dan CALLBACK_SECRET diperlukan untuk aksi get_qr.");
        process.exit(1);
    }

    let browser = null;
    try {
        console.log("1. Meluncurkan browser virtual...");
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await loginAndGetPage(browser);

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
            console.log("\n✅ QR Code Berhasil Didapatkan!");

            console.log(`8. Mengirim QR Code ke callback URL...`);
            const callbackPayload = {
                secret: CALLBACK_SECRET,
                qrCode: qr_data_url,
                sessionId: session_name
            };

            const callbackResponse = await fetch(CALLBACK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(callbackPayload)
            });
            
            if (callbackResponse.ok) {
                console.log("   ✅ Berhasil mengirim data ke shared hosting.");
            } else {
                const errorText = await callbackResponse.text();
                throw new Error(`Gagal mengirim data. Status: ${callbackResponse.status}. Pesan: ${errorText}`);
            }
        } else {
            throw new Error(`Gagal mendapatkan QR Code dari API. Pesan: ${result.msg}`);
        }

    } catch (error) {
        console.error("❌ Terjadi error selama proses get_qr:", error.message);
        process.exit(1);
    } finally {
        if (browser) {
            console.log("\n9. Menutup browser...");
            await browser.close();
        }
    }
}

// --- FUNGSI UNTUK MENGONTROL BLAST (START/STOP) ---
async function controlBlast(botId, action) {
    if (!botId) {
        console.error("❌ Error: BOT_ID (ID Akun WhatsApp) diperlukan untuk aksi ini.");
        process.exit(1);
    }
    
    console.log(`Memulai aksi '${action}' untuk bot ID: ${botId}`);

    let browser = null;
    try {
        console.log("1. Meluncurkan browser virtual...");
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await loginAndGetPage(browser);

        console.log(`5. Menavigasi ke halaman /bots untuk mencari bot...`);
        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });

        let buttonSelector;
        let actionText = action === 'start' ? 'Mulai Blast' : 'Stop Blast';

        if (action === 'start') {
            buttonSelector = `button[onclick*="updateBotSending(${botId}, '1')"]`;
        } else { // action === 'stop'
            buttonSelector = `button[onclick*="updateBotSending(${botId}, '0')"]`;
        }
        
        console.log(`6. Mencari tombol '${actionText}'...`);
        await page.waitForSelector(buttonSelector, { timeout: 15000 });
        
        console.log(`7. Mengklik tombol '${actionText}'...`);
        await page.click(buttonSelector);

        // Beri jeda singkat agar aksi sempat diproses di frontend terimawa
        await page.waitForTimeout(2000); 

        console.log(`   ✅ Aksi '${action}' berhasil dipicu untuk bot ${botId}.`);
        // Di sini bisa ditambahkan callback ke server Anda jika perlu

    } catch (error) {
        console.error(`❌ Terjadi error saat menjalankan aksi '${action}':`, error.message);
        process.exit(1);
    } finally {
        if (browser) {
            console.log("\n8. Menutup browser...");
            await browser.close();
        }
    }
}

// --- TITIK MASUK SCRIPT ---
// Memanggil fungsi utama untuk memulai proses
main();
