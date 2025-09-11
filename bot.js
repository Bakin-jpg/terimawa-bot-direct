const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

// --- KONFIGURASI APLIKASI ---
const LOGIN_PAGE_URL = "https://app.terimawa.com/login";
const SUCCESS_URL_REDIRECT = "https://app.terimawa.com/";
const BOTS_PAGE_URL = "https://app.terimawa.com/bots";
// API URL untuk blast mungkin perlu disesuaikan jika berbeda
const API_BLAST_URL = "https://app.terimawa.com/api/bots"; 

// --- AMBIL SEMUA VARIABEL DARI ENVIRONMENT (WORKFLOW) ---
const {
    TERIMAWA_USERNAME,
    TERIMAWA_PASSWORD,
    CALLBACK_URL,
    CALLBACK_SECRET,
    ACTION,
    BOT_ID,
    PHONE_NUMBER,
    BLAST_MODE,
    DB_ACCOUNT_ID // Variabel PENTING dari trigger.php untuk polling
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
        case 'start_blast':
            await controlBlast(BOT_ID, 'start', BLAST_MODE);
            break;
        case 'stop_blast':
            await controlBlast(BOT_ID, 'stop', null);
            break;
        default:
            const errorMsg = `Aksi tidak dikenal atau tidak disediakan: ${ACTION}`;
            console.error(`❌ ${errorMsg}`);
            // Kirim notifikasi error jika DB_ACCOUNT_ID ada
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
    
    console.log(`   ✅ Login berhasil.`);
    return page;
}

// --- FUNGSI CALLBACK KE SERVER ANDA ---
async function sendResultToCallback(payload) {
    if (!CALLBACK_URL || !CALLBACK_SECRET) {
        console.log("⚠️ Peringatan: CALLBACK_URL atau CALLBACK_SECRET tidak diatur. Hasil tidak akan dikirim kembali.");
        console.log("Payload:", JSON.stringify(payload));
        return;
    }
    
    console.log(`-> Mengirim hasil ke callback URL: ${CALLBACK_URL}`);
    
    const callbackPayload = { 
        ...payload, 
        secret: CALLBACK_SECRET,
        db_account_id: DB_ACCOUNT_ID // Selalu kirim ID database agar server tahu record mana yang harus diupdate
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

        console.log("6. Mengklik tombol 'Tambah Bot'...");
        await page.click('button:has-text("Tambah Bot")'); // Sesuaikan selector jika perlu

        console.log("7. Menunggu QR Code muncul...");
        // Selector untuk gambar QR. Sesuaikan jika berbeda di TerimaWA
        const qrImageSelector = 'img[alt="QR Code"]'; 
        await page.waitForSelector(qrImageSelector, { timeout: 30000 });
        
        const qrCodeSrc = await page.$eval(qrImageSelector, img => img.src);
        
        if (!qrCodeSrc.startsWith('data:image')) {
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

        console.log("6. Mengklik tombol 'Tambah Bot'...");
        await page.click('button:has-text("Tambah Bot")');

        console.log("7. Beralih ke metode Pairing Code...");
        // Selector untuk tombol/tab pairing code. Sesuaikan jika perlu
        await page.click('button:has-text("Pairing Code")'); 

        console.log(`8. Memasukkan nomor HP: ${phoneNumber}`);
        // Selector untuk input nomor HP. Sesuaikan jika perlu
        await page.type('input[name="phone"]', phoneNumber);

        console.log("9. Mengklik tombol untuk mendapatkan kode...");
        await page.click('button:has-text("Dapatkan Kode")'); // Sesuaikan selector jika perlu

        console.log("10. Menunggu Pairing Code muncul...");
        // Selector untuk elemen yang menampilkan pairing code. Sesuaikan!
        const pairingCodeSelector = 'h3.pairing-code'; // Ini hanya contoh selector
        await page.waitForSelector(pairingCodeSelector, { timeout: 30000 });
        
        const pairingCodeText = await page.$eval(pairingCodeSelector, el => el.textContent.trim());

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


/**
 * Mengontrol proses blast (start/stop) melalui API
 * Fungsi ini tidak menggunakan Puppeteer untuk blast, tapi mengambil cookies
 * @param {string} botId ID bot di TerimaWA
 * @param {string} action 'start' or 'stop'
 * @param {string|null} blastMode 'slow', 'medium', 'fast'
 */
async function controlBlast(botId, action, blastMode) {
    let browser = null;
    try {
        browser = await launchBrowser();
        const page = await loginAndGetPage(browser);

        console.log("5. Mengambil cookies sesi...");
        const cookies = await page.cookies();
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        console.log(`6. Mengirim perintah '${action}' untuk Bot ID: ${botId}`);
        const payload = {
            action: action, // 'start' atau 'stop'
            mode: blastMode // 'fast', 'medium', 'slow', akan diabaikan jika action='stop'
        };

        const response = await fetch(`${API_BLAST_URL}/${botId}/control`, { // Contoh URL API
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieString,
                'X-Requested-With': 'XMLHttpRequest' // Header ini mungkin diperlukan
            },
            body: JSON.stringify(payload)
        });
        
        const responseData = await response.json();

        if (!response.ok || responseData.status !== 'success') {
            throw new Error(responseData.message || `Gagal mengirim perintah ${action}.`);
        }

        console.log(`   ✅ Perintah '${action}' berhasil dikirim.`);
        // Tidak perlu kirim callback, karena ini adalah aksi langsung, bukan bagian dari polling
        // Tapi bisa ditambahkan jika perlu
    
    } catch (error) {
        console.error(`❌ Terjadi error saat ${action} blast:`, error.message);
        // Bisa ditambahkan callback error jika perlu
    } finally {
        if (browser) {
            await browser.close();
            console.log("Browser ditutup.");
        }
    }
}


// --- JALANKAN FUNGSI UTAMA ---
main();
