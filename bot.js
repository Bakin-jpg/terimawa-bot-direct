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
    BLAST_MODE, // Variabel BARU untuk mode blast (contoh: 'fast', 'medium', 'slow')
    CALLBACK_EXTRA_DATA // Ini adalah session_id unik dari PHP ('req_...')
} = process.env;

// --- FUNGSI UTAMA (ROUTER) ---
async function main() {
    if (!TERIMAWA_USERNAME || !TERIMAWA_PASSWORD) {
        console.error("❌ Error: Kredensial TERIMAWA_USERNAME atau TERIMAWA_PASSWORD tidak diatur di GitHub Secrets.");
        process.exit(1);
    }

    console.log(`🚀 Menjalankan aksi: ${ACTION || 'Tidak ada aksi'}`);

    switch (ACTION) {
        case 'get_qr':
            await getQrCode();
            break;
        case 'get_pairing_code':
            await getPairingCode(PHONE_NUMBER);
            break;
        case 'start_blast':
            // Sekarang kita teruskan BLAST_MODE ke fungsi controlBlast
            await controlBlast(BOT_ID, 'start', BLAST_MODE);
            break;
        case 'stop_blast':
            await controlBlast(BOT_ID, 'stop', null); // Stop tidak butuh mode
            break;
        default:
            console.error(`❌ Aksi tidak dikenal atau tidak disediakan: ${ACTION}`);
            process.exit(1);
    }
}

// --- FUNGSI LOGIN ---
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
        throw new Error(`Gagal login. URL saat ini: ${page.url()}. Pastikan kredensial benar.`);
    }
    
    console.log(`   ✅ Login berhasil. URL saat ini: ${page.url()}`);
    return page;
}

// --- FUNGSI UNTUK MENGIRIM HASIL KE SERVER ANDA (CALLBACK) ---
async function sendResultToCallback(payload) {
    if (!CALLBACK_URL || !CALLBACK_SECRET) {
        console.log("⚠️ Peringatan: CALLBACK_URL atau CALLBACK_SECRET tidak diatur. Hasil tidak akan dikirim kembali.");
        return;
    }
    
    console.log(`-> Mengirim hasil ke callback URL: ${CALLBACK_URL}`);
    
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
            console.log("   ✅ Berhasil mengirim data ke server Anda.");
        } else {
            const errorText = await callbackResponse.text();
            throw new Error(`Gagal mengirim data. Status: ${callbackResponse.status}. Pesan: ${errorText}`);
        }
    } catch (error) {
        console.error("   ⚠️ Peringatan: Gagal mengirim data ke server Anda.", error.message);
    }
}

// --- FUNGSI UNTUK MENGONTROL BLAST (START/STOP) ---
async function controlBlast(botId, action, blastMode) {
    if (!botId) {
        const errorMessage = "Error: BOT_ID diperlukan untuk aksi ini.";
        console.error(`❌ ${errorMessage}`);
        await sendResultToCallback({ type: 'error', message: errorMessage });
        process.exit(1);
    }
    console.log(`Memulai aksi '${action}' untuk bot ID: ${botId}`);
    let browser = null;
    try {
        console.log("1. Meluncurkan browser dan login...");
        browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: chromium.headless });
        const page = await loginAndGetPage(browser);
        
        console.log(`5. Menavigasi ke halaman /bots untuk mencari bot...`);
        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });
        
        if (action === 'start') {
            const mode = blastMode || 'medium'; // Default ke 'medium' jika mode tidak disediakan
            console.log(`6. Memilih mode blast: '${mode}'`);

            // Selector untuk dropdown delay. Ganti jika selector di terimawa.com berbeda.
            const delaySelector = `select[onchange="updateBotSendingSpeed(${botId}, this.value)"]`;
            
            try {
                await page.waitForSelector(delaySelector, { timeout: 15000 });
                // Nilai ('fast', 'medium', 'slow') harus cocok dengan <option value="..."> di HTML terimawa.com
                await page.select(delaySelector, mode); 
                console.log(`   ✅ Mode '${mode}' berhasil dipilih untuk bot ${botId}.`);
                await page.waitForTimeout(1000); // Beri jeda sesaat agar AJAX (jika ada) selesai
            } catch(e) {
                console.warn(`   ⚠️ Peringatan: Tidak dapat menemukan atau memilih dropdown mode blast. Menggunakan mode default yang tersimpan di terimawa.`);
            }

            // Lanjutkan untuk menekan tombol Start
            const buttonSelector = `button[onclick*="updateBotSending(${botId}, '1')"]`;
            console.log("7. Mencari dan mengklik tombol 'Mulai Blast'...");
            await page.waitForSelector(buttonSelector, { timeout: 15000 });
            await page.click(buttonSelector);

        } else { // action === 'stop'
            // Langsung tekan tombol Stop
            const buttonSelector = `button[onclick*="updateBotSending(${botId}, '0')"]`;
            console.log("6. Mencari dan mengklik tombol 'Stop Blast'...");
            await page.waitForSelector(buttonSelector, { timeout: 15000 });
            await page.click(buttonSelector);
        }
        
        await page.waitForTimeout(2000); // Jeda untuk memastikan perintah diproses

        console.log(`   ✅ Aksi '${action}' berhasil dipicu untuk bot ${botId}.`);
        await sendResultToCallback({ type: 'blast_status', status: `Aksi ${action} berhasil untuk bot ${botId}` });

    } catch (error) {
        console.error(`❌ Terjadi error saat menjalankan aksi '${action}':`, error.message);
        await sendResultToCallback({ type: 'error', message: `Gagal menjalankan aksi ${action} untuk bot ${botId}: ${error.message}` });
        process.exit(1);
    } finally {
        if (browser) {
            console.log("\n8. Menutup browser...");
            await browser.close();
        }
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
            await sendResultToCallback({ type: 'qr', qrCode: result.msg, sessionId: result.session });
        } else {
            throw new Error(`Gagal mendapatkan QR Code dari API. Pesan: ${result.msg}`);
        }
    } catch (error) {
        console.error("❌ Terjadi error saat proses get_qr:", error.message);
        await sendResultToCallback({ type: 'error', message: error.message });
        process.exit(1);
    } finally {
        if (browser) { await browser.close(); }
    }
}

// --- FUNGSI UNTUK MENGAMBIL PAIRING CODE ---
async function getPairingCode(phoneNumber) {
    if (!phoneNumber) {
        const errorMessage = "Error: Nomor telepon diperlukan untuk aksi get_pairing_code.";
        console.error(`❌ ${errorMessage}`);
        await sendResultToCallback({ type: 'error', message: errorMessage });
        process.exit(1);
    }
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
        console.log("7. Memilih metode 'Pairing Code' dan mengisi nomor...");
        await page.click('input[name="connectionMethod"][value="pairing"]');
        await page.type('#phoneNumber', phoneNumber);
        console.log("8. Mengklik 'Lanjut' dan menunggu respons API...");
        const [response] = await Promise.all([
            page.waitForResponse(res => res.url() === API_URL && res.request().method() === 'POST'),
            page.click('#addBotSubmit'),
        ]);
        const result = await response.json();
        if (result.error === '0' && result.msg) {
            console.log("\n✅ Pairing Code Berhasil Didapatkan!");
            await sendResultToCallback({ type: 'pairing', pairingCode: result.msg, sessionId: result.session });
        } else {
            throw new Error(`Gagal mendapatkan Pairing Code dari API. Pesan: ${result.msg}`);
        }
    } catch (error) {
        console.error("❌ Terjadi error saat proses get_pairing_code:", error.message);
        await sendResultToCallback({ type: 'error', message: error.message });
        process.exit(1);
    } finally {
        if (browser) { await browser.close(); }
    }
}

// --- TITIK MASUK SCRIPT ---
main();
