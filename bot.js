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
    // Validasi input penting
    if (!TERIMAWA_USERNAME || !TERIMAWA_PASSWORD) {
        await sendResultToCallback({ status: 'error', message: 'Kredensial TerimaWA tidak diatur di environment.' });
        console.error("❌ Error: Kredensial TERIMAWA_USERNAME atau TERIMAWA_PASSWORD tidak diatur.");
        process.exit(1);
    }
     if (!DB_ACCOUNT_ID && (ACTION === 'get_qr' || ACTION === 'get_pairing_code')) {
        await sendResultToCallback({ status: 'error', message: 'DB Account ID tidak ditemukan. Proses tidak bisa dilanjutkan.' });
        console.error("❌ Error: DB_ACCOUNT_ID tidak diatur untuk aksi koneksi bot.");
        process.exit(1);
    }

    console.log(`🚀 Menjalankan aksi: ${ACTION}`);

    switch (ACTION) {
        case 'get_qr':
            await getQrCode();
            break;
        case 'get_pairing_code':
            await getPairingCode(PHONE_NUMBER);
            break;
        default:
            const errorMsg = `Aksi tidak dikenal atau tidak disediakan: ${ACTION}`;
            console.error(`❌ ${errorMsg}`);
            if (DB_ACCOUNT_ID) {
                await sendResultToCallback({ status: 'error', message: errorMsg });
            }
            process.exit(1);
    }
}

// --- FUNGSI HELPER UNTUK BROWSER ---
async function launchBrowser() {
    console.log("1. Meluncurkan browser...");
    return await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });
}

// --- FUNGSI LOGIN ---
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
        throw new Error(`Gagal login. URL saat ini: ${page.url()}. Pastikan kredensial benar.`);
    }
    
    console.log(`   ✅ Login berhasil.`);
    return page;
}

// --- FUNGSI CALLBACK KE SERVER ANDA ---
async function sendResultToCallback(payload) {
    if (!CALLBACK_URL || !CALLBACK_SECRET) {
        console.log("⚠️ Peringatan: CALLBACK_URL atau CALLBACK_SECRET tidak diatur. Hasil tidak akan dikirim kembali.");
        console.log("Payload yang tidak terkirim:", JSON.stringify(payload));
        return;
    }
    
    console.log(`-> Mengirim hasil ke callback URL: ${CALLBACK_URL}`);
    
    const callbackPayload = { 
        ...payload, 
        secret: CALLBACK_SECRET,
        db_account_id: DB_ACCOUNT_ID
    };
    
    try {
        const response = await fetch(CALLBACK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(callbackPayload)
        });
        
        if (response.ok) {
            console.log("   ✅ Berhasil mengirim data ke server Anda.");
        } else {
            const errorText = await response.text();
            throw new Error(`Gagal mengirim data. Status: ${response.status}. Pesan: ${errorText}`);
        }
    } catch (error) {
        console.error("   ❌ GAGAL mengirim data ke server Anda:", error.message);
    }
}

// --- FUNGSI-FUNGSI AKSI ---

/**
 * Mendapatkan QR Code untuk koneksi WhatsApp
 */
async function getQrCode() {
    let browser = null;
    try {
        browser = await launchBrowser();
        const page = await loginAndGetPage(browser);

        console.log(`5. Menavigasi ke halaman Bots: ${BOTS_PAGE_URL}`);
        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });
        console.log("   Halaman bots berhasil dimuat.");

        console.log("6. Mencari dan mengklik tombol 'Tambah WhatsApp'...");
        // =========================================================================
        // PERBAIKAN FINAL: Mengganti "Tambah Bot" menjadi "Tambah WhatsApp"
        // =========================================================================
        const addButtonXPath = "//button[contains(., 'Tambah WhatsApp')]";
        await page.waitForXPath(addButtonXPath, { timeout: 15000 }); // Tunggu 15 detik
        const [addButton] = await page.$x(addButtonXPath);
        
        if (addButton) {
            console.log("   Tombol ditemukan, mencoba mengklik...");
            await addButton.click();
        } else {
            throw new Error("Tombol 'Tambah WhatsApp' tidak ditemukan di halaman.");
        }
        
        console.log("7. Menunggu modal atau QR Code muncul...");
        // Kita asumsikan QR code ada di dalam modal, cari selector yang lebih umum dulu
        const qrImageSelector = 'img[src^="data:image"]'; // Cari gambar apa pun yang sumbernya adalah data base64
        await page.waitForSelector(qrImageSelector, { timeout: 45000 }); // Beri waktu 45 detik untuk QR generate
        
        const qrCodeSrc = await page.$eval(qrImageSelector, img => img.src);
        
        if (!qrCodeSrc) {
            throw new Error('Gagal mendapatkan data base64 dari QR Code.');
        }

        console.log("   ✅ QR Code berhasil didapatkan.");
        await sendResultToCallback({ status: 'success', type: 'qr', data: qrCodeSrc });

    } catch (error) {
        console.error("❌ Terjadi error saat mengambil QR Code:", error.message);
        await sendResultToCallback({ status: 'error', message: error.message || 'Gagal mengambil QR Code.' });
    } finally {
        if (browser) {
            await browser.close();
            console.log("Browser ditutup.");
        }
    }
}

/**
 * Mendapatkan Pairing Code berdasarkan Nomor HP
 * @param {string} phoneNumber Nomor HP dengan kode negara
 */
async function getPairingCode(phoneNumber) {
    if (!phoneNumber) {
        const errorMsg = "Nomor HP tidak disediakan untuk pairing code.";
        console.error(`❌ ${errorMsg}`);
        await sendResultToCallback({ status: 'error', message: errorMsg });
        return;
    }
    
    let browser = null;
    try {
        browser = await launchBrowser();
        const page = await loginAndGetPage(browser);

        console.log(`5. Menavigasi ke halaman Bots: ${BOTS_PAGE_URL}`);
        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });
        console.log("   Halaman bots berhasil dimuat.");

        console.log("6. Mencari dan mengklik tombol 'Tambah WhatsApp'...");
        // =========================================================================
        // PERBAIKAN FINAL: Mengganti "Tambah Bot" menjadi "Tambah WhatsApp"
        // =========================================================================
        const addButtonXPath = "//button[contains(., 'Tambah WhatsApp')]";
        await page.waitForXPath(addButtonXPath, { timeout: 15000 });
        const [addButton] = await page.$x(addButtonXPath);

        if (addButton) {
            console.log("   Tombol ditemukan, mencoba mengklik...");
            await addButton.click();
        } else {
            throw new Error("Tombol 'Tambah WhatsApp' tidak ditemukan.");
        }

        console.log("7. Menunggu modal muncul dan beralih ke metode Pairing Code...");
        const pairingRadioButtonXPath = "//input[@name='connectionMethod' and @value='pairing']";
        await page.waitForXPath(pairingRadioButtonXPath, { timeout: 10000 });
        const [pairingRadioButton] = await page.$x(pairingRadioButtonXPath);
        if(pairingRadioButton) {
            await pairingRadioButton.click();
            console.log("   Metode pairing dipilih.");
        } else {
            throw new Error("Pilihan 'Pairing Code' tidak ditemukan di modal.");
        }

        console.log(`8. Memasukkan nomor HP: ${phoneNumber}`);
        // Selector input ini biasanya stabil
        await page.waitForSelector('input#phoneNumber');
        await page.type('input#phoneNumber', phoneNumber);

        console.log("9. Mencari dan mengklik tombol 'Lanjut'...");
        const submitButtonXPath = "//button[@id='addBotSubmit' and contains(., 'Lanjut')]";
        await page.waitForXPath(submitButtonXPath);
        const [submitButton] = await page.$x(submitButtonXPath);

        if (submitButton) {
            await submitButton.click();
        } else {
            throw new Error("Tombol 'Lanjut' tidak ditemukan.");
        }

        console.log("10. Menunggu Pairing Code muncul...");
        // Dari inspect element, kodenya ada di dalam div dengan font-mono
        const pairingCodeXPath = "//div[contains(@class, 'font-mono')]"; 
        await page.waitForXPath(pairingCodeXPath, { timeout: 45000 });
        const [pairingCodeElement] = await page.$x(pairingCodeXPath);
        
        if (!pairingCodeElement) {
            throw new Error('Elemen untuk Pairing Code tidak ditemukan.');
        }

        const pairingCodeText = await page.evaluate(el => el.textContent.trim(), pairingCodeElement);

        if (!pairingCodeText) {
            throw new Error('Gagal mendapatkan teks Pairing Code.');
        }
        
        console.log(`   ✅ Pairing Code didapatkan: ${pairingCodeText}`);
        await sendResultToCallback({ status: 'success', type: 'pairing_code', data: pairingCodeText });

    } catch (error) {
        console.error("❌ Terjadi error saat mengambil Pairing Code:", error.message);
        await sendResultToCallback({ status: 'error', message: error.message || 'Gagal mengambil Pairing Code.' });
    } finally {
        if (browser) {
            await browser.close();
            console.log("Browser ditutup.");
        }
    }
}

// --- JALANKAN FUNGSI UTAMA ---
main();
