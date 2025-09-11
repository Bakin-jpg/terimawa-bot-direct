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
    if (!TERIMAWA_USERNAME || !TERIMAWA_PASSWORD || !DB_ACCOUNT_ID) {
        await sendResultToCallback({ status: 'error', message: 'Variabel environment penting tidak diatur.' });
        process.exit(1);
    }
    console.log(`🚀 Menjalankan aksi: ${ACTION}`);
    switch (ACTION) {
        case 'get_qr':
            await handleConnectionProcess('qr');
            break;
        case 'get_pairing_code':
            await handleConnectionProcess('pairing', PHONE_NUMBER);
            break;
        default:
            const errorMsg = `Aksi tidak dikenal: ${ACTION}`;
            await sendResultToCallback({ status: 'error', message: errorMsg });
            process.exit(1);
    }
}

// --- FUNGSI HELPER ---
async function launchBrowser() { /* ... (Tetap Sama) ... */ }
async function loginAndGetPage(browser) { /* ... (Tetap Sama) ... */ }
async function sendResultToCallback(payload) { /* ... (Tetap Sama) ... */ }

// =========================================================================
// FUNGSI UTAMA YANG BARU: Menggabungkan semua logika koneksi
// =========================================================================
async function handleConnectionProcess(mode, phoneNumber = null) {
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
        
        // Pilih metode dan klik lanjut
        if (mode === 'pairing') {
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
        
        // Dapatkan QR atau Pairing Code dan kirim callback pertama
        if (mode === 'qr') {
            console.log("11. Menunggu modal QR Code muncul...");
            const qrImageSelector = 'img#qrCodeImage';
            await page.waitForSelector(qrImageSelector, { timeout: 60000, visible: true });
            const qrCodeSrc = await page.$eval(qrImageSelector, img => img.src);
            if (!qrCodeSrc) throw new Error('Gagal mendapatkan data QR Code.');
            console.log("   ✅ QR Code berhasil didapatkan, mengirim ke server...");
            await sendResultToCallback({ status: 'success', type: 'qr_ready', data: qrCodeSrc });
        } else { // mode pairing
            console.log("11. Menunggu modal Pairing Code muncul...");
            const pairingCodeXPath = "//div[contains(@class, 'font-mono')]";
            await page.waitForXPath(pairingCodeXPath, { timeout: 60000, visible: true });
            const [pairingCodeElement] = await page.$x(pairingCodeXPath);
            if (!pairingCodeElement) throw new Error('Elemen pairing code tidak ditemukan.');
            const pairingCodeText = await page.evaluate(el => el.textContent.trim(), pairingCodeElement);
            if (!pairingCodeText) throw new Error('Gagal mendapatkan teks Pairing Code.');
            console.log(`   ✅ Pairing Code didapatkan: ${pairingCodeText}, mengirim ke server...`);
            await sendResultToCallback({ status: 'success', type: 'pairing_ready', data: pairingCodeText });
        }

        // =========================================================================
        // LANGKAH KRUSIAL: Jangan berhenti, pantau halaman untuk status terhubung
        // =========================================================================
        console.log("12. Memantau status koneksi di halaman (menunggu hingga 2 menit)...");
        // Kita asumsikan setelah terhubung, halaman akan redirect atau menampilkan pesan sukses
        // Cara paling andal adalah menunggu URL berubah kembali ke /bots
        await page.waitForNavigation({ timeout: 120000 }); // Tunggu hingga 2 menit
        
        if (page.url().includes(BOTS_PAGE_URL)) {
             console.log("   ✅ Perangkat terdeteksi terhubung!");
             // Setelah terhubung, kita perlu mengambil info bot baru (opsional tapi bagus)
             // Untuk kesederhanaan, kita langsung kirim status 'connected'
             await sendResultToCallback({ 
                status: 'success', 
                type: 'connected', 
                // Di sini Anda bisa menambahkan logika untuk scrape nomor HP/bot ID jika perlu
             });
        } else {
            throw new Error("Halaman tidak redirect setelah koneksi, timeout.");
        }
        
    } catch (error) {
        console.error(`❌ Terjadi error saat proses '${mode}':`, error.message);
        await sendResultToCallback({ status: 'error', message: error.message || `Gagal total saat proses ${mode}.` });
    } finally {
        if (browser) {
            await browser.close();
            console.log("Browser ditutup.");
        }
    }
}

// Helper functions (Tetap sama)
async function launchBrowser() { /* ... */ }
async function loginAndGetPage(browser) { /* ... */ }
async function sendResultToCallback(payload) { /* ... */ }

// --- JALANKAN FUNGSI UTAMA ---
main();
