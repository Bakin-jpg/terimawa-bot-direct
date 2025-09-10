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
    BOT_ID,
    PHONE_NUMBER,
    CALLBACK_EXTRA_DATA // Ini adalah session_id unik dari PHP
} = process.env;

// --- FUNGSI UTAMA (ROUTER) ---
async function main() {
    if (!TERIMAWA_USERNAME || !TERIMAWA_PASSWORD) {
        console.error("❌ Error: Kredensial tidak diatur di GitHub Secrets.");
        process.exit(1);
    }

    console.log(`🚀 Menjalankan aksi: ${ACTION || 'Tidak ada aksi'}`);

    // Kita akan fokus pada get_qr untuk sekarang
    switch (ACTION) {
        case 'get_qr':
            await getQrCode();
            break;
        // Aksi lain bisa ditambahkan di sini nanti
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

    console.log("4. Mengklik tombol login...");
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
        page.click('button[type="submit"]')
    ]);

    if (!page.url().startsWith(SUCCESS_URL_REDIRECT)) {
        throw new Error(`Gagal login. URL saat ini: ${page.url()}.`);
    }
    
    console.log(`   ✅ Login berhasil. URL saat ini: ${page.url()}`);
    return page;
}

// --- FUNGSI UNTUK MENGIRIM HASIL KE SERVER ANDA ---
async function sendResultToCallback(payload) {
    if (!CALLBACK_URL || !CALLBACK_SECRET) {
        console.error("❌ Error: CALLBACK_URL dan CALLBACK_SECRET diperlukan untuk mengirim hasil.");
        return; // Keluar dari fungsi jika URL callback tidak ada
    }
    
    console.log(`8. Mengirim hasil ke callback URL: ${CALLBACK_URL}`);
    
    // Gabungkan payload utama dengan secret dan data tambahan (session_id)
    const callbackPayload = { 
        ...payload, 
        secret: CALLBACK_SECRET,
        callbackExtraData: CALLBACK_EXTRA_DATA // Kirim kembali session_id
    };
    
    try {
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
    } catch (error) {
        // Log error tapi jangan hentikan eksekusi utama jika hanya callback yang gagal
        console.error("   ⚠️ Peringatan: Gagal mengirim data ke shared hosting.", error.message);
    }
}

// --- FUNGSI UNTUK MENGAMBIL QR CODE ---
async function getQrCode() {
    let browser = null;
    try {
        console.log("1. Meluncurkan browser...");
        browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: chromium.headless });
        const page = await loginAndGetPage(browser);
        
        console.log(`5. Menavigasi ke halaman WhatsApp Bots...`);
        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });
        
        console.log("6. Mengklik 'Tambah WhatsApp'...");
        await page.waitForSelector('#addBotBtn', { timeout: 15000 });
        await page.click('#addBotBtn');
        
        console.log("7. Mengklik 'Lanjut' (metode QR)...");
        const [response] = await Promise.all([
            page.waitForResponse(res => res.url() === API_URL && res.request().method() === 'POST'),
            page.click('#addBotSubmit'),
        ]);
        
        const result = await response.json();
        
        if (result.error === '0' && result.msg) {
            console.log("\n✅ QR Code Berhasil Didapatkan di GitHub!");
            
            // Kirim hasilnya ke server PHP Anda
            await sendResultToCallback({
                type: 'qr',
                qrCode: result.msg,
                sessionId: result.session
            });
        } else {
            throw new Error(`Gagal mendapatkan QR Code dari API. Pesan: ${result.msg}`);
        }

    } catch (error) {
        console.error("❌ Terjadi error saat proses get_qr:", error.message);
        // Kirim notifikasi error ke server Anda jika terjadi kesalahan
        await sendResultToCallback({ type: 'error', message: error.message });
        process.exit(1);
    } finally {
        if (browser) {
            console.log("\n9. Menutup browser...");
            await browser.close();
        }
    }
}

// --- TITIK MASUK SCRIPT ---
main();
