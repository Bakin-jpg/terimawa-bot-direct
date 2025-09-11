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
    DB_ACCOUNT_ID // Variabel KUNCI untuk polling berbasis database
} = process.env;


// --- FUNGSI UTAMA (ROUTER) ---
async function main() {
    // Validasi input penting
    if (!TERIMAWA_USERNAME || !TERIMAWA_PASSWORD) {
        await sendResultToCallback({ status: 'error', message: 'Kredensial TerimaWA tidak diatur di environment.' });
        console.error("❌ Error: Kredensial TERIMAWA_USERNAME atau TERIMAWA_PASSWORD tidak diatur.");
        process.exit(1);
    }
     if (!DB_ACCOUNT_ID) {
        // Kita tidak bisa mengirim callback error jika DB_ACCOUNT_ID tidak ada,
        // jadi kita hanya log error di sini.
        console.error("❌ Error: DB_ACCOUNT_ID tidak diatur. Proses callback tidak akan berhasil.");
        process.exit(1);
    }

    console.log(`🚀 Menjalankan aksi: ${ACTION}`);

    switch (ACTION) {
        case 'get_qr':
            await getQr();
            break;
        case 'get_pairing_code':
            await getPairing(PHONE_NUMBER);
            break;
        default:
            const errorMsg = `Aksi tidak dikenal atau tidak disediakan: ${ACTION}`;
            console.error(`❌ ${errorMsg}`);
            await sendResultToCallback({ status: 'error', message: errorMsg });
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
    
    // Siapkan payload dengan db_account_id
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

async function getQr() {
    let browser = null;
    try {
        browser = await launchBrowser();
        const page = await loginAndGetPage(browser);

        console.log(`5. Menavigasi ke halaman Bots: ${BOTS_PAGE_URL}`);
        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });
        console.log("   Halaman bots berhasil dimuat.");

        console.log("6. Mengklik tombol 'Tambah WhatsApp'...");
        const addButtonXPath = "//button[@id='addBotBtn']";
        await page.waitForXPath(addButtonXPath);
        const [addButton] = await page.$x(addButtonXPath);
        await addButton.click();

        console.log("7. Menunggu modal pilihan metode muncul...");
        await page.waitForSelector('#addBotModal:not(.hidden)');
        
        console.log("8. Metode QR sudah default, mengklik tombol 'Lanjut'...");
        const submitButtonXPath = "//button[@id='addBotSubmit']";
        await page.waitForXPath(submitButtonXPath);
        const [submitButton] = await page.$x(submitButtonXPath);
        await submitButton.click();

        console.log("9. Menunggu modal QR Code muncul...");
        const qrImageSelector = 'img#qrCodeImage';
        await page.waitForSelector(qrImageSelector, { timeout: 60000, visible: true });
        
        const qrCodeSrc = await page.$eval(qrImageSelector, img => img.src);

        if (!qrCodeSrc || !qrCodeSrc.startsWith('data:image')) {
            throw new Error('Gagal mendapatkan data base64 dari QR Code.');
        }

        console.log("   ✅ QR Code berhasil didapatkan.");
        await sendResultToCallback({ status: 'success', type: 'qr', data: qrCodeSrc });

    } catch (error) {
        console.error("❌ Terjadi error saat proses QR:", error.message);
        await sendResultToCallback({ status: 'error', message: error.message || 'Gagal total saat proses QR.' });
    } finally {
        if (browser) await browser.close();
    }
}

async function getPairing(phoneNumber) {
    if (!phoneNumber) {
        await sendResultToCallback({ status: 'error', message: 'Nomor HP wajib untuk pairing code.' });
        return;
    }

    let browser = null;
    try {
        browser = await launchBrowser();
        const page = await loginAndGetPage(browser);

        console.log(`5. Menavigasi ke halaman Bots: ${BOTS_PAGE_URL}`);
        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });
        console.log("   Halaman bots berhasil dimuat.");

        console.log("6. Mengklik tombol 'Tambah WhatsApp'...");
        const addButtonXPath = "//button[@id='addBotBtn']";
        await page.waitForXPath(addButtonXPath);
        const [addButton] = await page.$x(addButtonXPath);
        await addButton.click();

        console.log("7. Menunggu modal pilihan metode muncul...");
        await page.waitForSelector('#addBotModal:not(.hidden)');
        
        console.log("8. Memilih metode 'Pairing Code'...");
        const pairingRadioButtonXPath = "//input[@name='connectionMethod' and @value='pairing']";
        await page.waitForXPath(pairingRadioButtonXPath);
        const [pairingRadioButton] = await page.$x(pairingRadioButtonXPath);
        await pairingRadioButton.click();
        
        console.log(`9. Memasukkan nomor HP: ${phoneNumber}`);
        await page.waitForSelector('input#phoneNumber', { visible: true });
        await page.type('input#phoneNumber', phoneNumber);

        console.log("10. Mengklik tombol 'Lanjut'...");
        const submitButtonXPath = "//button[@id='addBotSubmit']";
        await page.waitForXPath(submitButtonXPath);
        const [submitButton] = await page.$x(submitButtonXPath);
        await submitButton.click();

        console.log("11. Menunggu modal Pairing Code muncul...");
        const pairingCodeXPath = "//div[contains(@class, 'font-mono')]";
        await page.waitForXPath(pairingCodeXPath, { timeout: 60000, visible: true });
        
        const [pairingCodeElement] = await page.$x(pairingCodeXPath);
        if (!pairingCodeElement) throw new Error('Elemen pairing code tidak ditemukan.');
        
        const pairingCodeText = await page.evaluate(el => el.textContent.trim(), pairingCodeElement);

        if (!pairingCodeText) {
            throw new Error('Gagal mendapatkan teks Pairing Code.');
        }

        console.log(`   ✅ Pairing Code didapatkan: ${pairingCodeText}`);
        await sendResultToCallback({ status: 'success', type: 'pairing_code', data: pairingCodeText });

    } catch (error) {
        console.error("❌ Terjadi error saat proses Pairing:", error.message);
        await sendResultToCallback({ status: 'error', message: error.message || 'Gagal total saat proses Pairing.' });
    } finally {
        if (browser) await browser.close();
    }
}

// --- JALANKAN FUNGSI UTAMA ---
main();
