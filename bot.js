const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

// --- KONFIGURASI APLIKASI ---
const LOGIN_PAGE_URL = "https://app.terimawa.com/login";
const SUCCESS_URL_REDIRECT = "https://app.terimawa.com/";
const BOTS_PAGE_URL = "https://app.terimawa.com/bots";

// --- AMBIL SEMUA VARIABEL DARI ENVIRONMENT (WORKFLOW) ---
const {
    TERIMAWA_USERNAME,
    TERIMAWA_PASSWORD,
    CALLBACK_URL,
    CALLBACK_SECRET,
    ACTION,
    PHONE_NUMBER,
    DB_ACCOUNT_ID
} = process.env;


// --- FUNGSI UTAMA (ROUTER) ---
async function main() {
    // Pindahkan validasi ke dalam try-catch agar error bisa ditangani dengan benar
    if (!TERIMAWA_USERNAME || !TERIMAWA_PASSWORD || !DB_ACCOUNT_ID) {
        console.error("❌ Error: Variabel environment penting (USERNAME, PASSWORD, atau DB_ACCOUNT_ID) tidak diatur.");
        // Kita tidak bisa mengirim callback di sini karena belum ada browser/koneksi.
        // Cukup hentikan proses.
        process.exit(1);
    }
    
    console.log(`🚀 Menjalankan aksi: ${ACTION}`);

    // Kita akan membungkus semua aksi dalam satu fungsi agar penanganan error-nya terpusat
    await handleConnectionProcess(ACTION, PHONE_NUMBER);
}

// --- FUNGSI HELPER ---
async function launchBrowser() {
    console.log("1. Meluncurkan browser...");
    return await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });
}

async function loginAndGetPage(browser) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
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
        throw new Error(`Gagal login. URL saat ini: ${page.url()}`);
    }
    console.log(`   ✅ Login berhasil.`);
    return page;
}

async function sendResultToCallback(payload) {
    if (!CALLBACK_URL || !CALLBACK_SECRET) {
        console.log("⚠️ Peringatan: CALLBACK_URL/SECRET tidak diatur.", JSON.stringify(payload));
        return;
    }
    console.log(`-> Mengirim hasil ke callback URL: ${CALLBACK_URL}`);
    const callbackPayload = { ...payload, secret: CALLBACK_SECRET, db_account_id: DB_ACCOUNT_ID };
    try {
        const response = await fetch(CALLBACK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(callbackPayload)
        });
        if (response.ok) console.log("   ✅ Berhasil mengirim data ke server Anda.");
        else throw new Error(`Status: ${response.status}. Pesan: ${await response.text()}`);
    } catch (error) {
        console.error("   ❌ GAGAL mengirim data ke server Anda:", error.message);
    }
}

// =========================================================================
// FUNGSI UTAMA YANG MENGGABUNGKAN SEMUA LOGIKA KONEKSI
// =========================================================================
async function handleConnectionProcess(action, phoneNumber = null) {
    if (action === 'get_pairing_code' && !phoneNumber) {
        await sendResultToCallback({ status: 'error', message: 'Nomor HP wajib untuk pairing code.' });
        return;
    }

    let browser = null;
    try {
        browser = await launchBrowser();
        const page = await loginAndGetPage(browser);

        console.log(`5. Menavigasi ke halaman Bots: ${BOTS_PAGE_URL}`);
        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });

        console.log("6. Mengklik tombol 'Tambah WhatsApp'...");
        const addButtonXPath = "//button[@id='addBotBtn']";
        await page.waitForXPath(addButtonXPath);
        const [addButton] = await page.$x(addButtonXPath);
        await addButton.click();

        console.log("7. Menunggu modal pilihan metode muncul...");
        await page.waitForSelector('#addBotModal:not(.hidden)');
        
        if (action === 'get_pairing_code') {
            console.log("8. Memilih metode 'Pairing Code'...");
            const pairingRadioButtonXPath = "//input[@name='connectionMethod' and @value='pairing']";
            await page.waitForXPath(pairingRadioButtonXPath);
            const [pairingRadioButton] = await page.$x(pairingRadioButtonXPath);
            await pairingRadioButton.click();
            
            console.log(`9. Memasukkan nomor HP: ${phoneNumber}`);
            await page.waitForSelector('input#phoneNumber', { visible: true });
            await page.type('input#phoneNumber', phoneNumber);
        } else {
             console.log("8. Metode QR sudah default.");
        }

        console.log("10. Mengklik tombol 'Lanjut'...");
        const submitButtonXPath = "//button[@id='addBotSubmit']";
        await page.waitForXPath(submitButtonXPath);
        const [submitButton] = await page.$x(submitButtonXPath);
        await submitButton.click();
        
        if (action === 'get_qr') {
            console.log("11. Menunggu modal QR Code muncul...");
            const qrImageSelector = 'img#qrCodeImage';
            await page.waitForSelector(qrImageSelector, { timeout: 60000, visible: true });
            const qrCodeSrc = await page.$eval(qrImageSelector, img => img.src);
            if (!qrCodeSrc) throw new Error('Gagal mendapatkan data QR Code.');
            console.log("   ✅ QR Code berhasil didapatkan, mengirim ke server...");
            await sendResultToCallback({ status: 'success', type: 'qr', data: qrCodeSrc });
        } else {
            console.log("11. Menunggu modal Pairing Code muncul...");
            const pairingCodeXPath = "//div[contains(@class, 'font-mono')]";
            await page.waitForXPath(pairingCodeXPath, { timeout: 60000, visible: true });
            const [pairingCodeElement] = await page.$x(pairingCodeXPath);
            if (!pairingCodeElement) throw new Error('Elemen pairing code tidak ditemukan.');
            const pairingCodeText = await page.evaluate(el => el.textContent.trim(), pairingCodeElement);
            if (!pairingCodeText) throw new Error('Gagal mendapatkan teks Pairing Code.');
            console.log(`   ✅ Pairing Code didapatkan: ${pairingCodeText}, mengirim ke server...`);
            await sendResultToCallback({ status: 'success', type: 'pairing_code', data: pairingCodeText });
        }

        console.log("12. Memantau status koneksi di halaman (menunggu hingga 2 menit)...");
        await page.waitForNavigation({ timeout: 120000 });
        
        if (page.url().includes(BOTS_PAGE_URL)) {
             console.log("   ✅ Perangkat terdeteksi terhubung!");
             const latestBotNumber = await page.$eval('#botsList li:first-child .text-sm.font-semibold', el => el.textContent.trim());
             await sendResultToCallback({ 
                status: 'success', 
                type: 'connected', 
                phone_number: latestBotNumber,
             });
        } else {
            throw new Error("Halaman tidak redirect setelah koneksi, timeout.");
        }
        
    } catch (error) {
        console.error(`❌ Terjadi error saat proses '${action}':`, error.message);
        await sendResultToCallback({ status: 'error', message: error.message || `Gagal total saat proses ${action}.` });
    } finally {
        if (browser) {
            await browser.close();
            console.log("Browser ditutup.");
        }
    }
}

// --- JALANKAN FUNGSI UTAMA ---
main();
