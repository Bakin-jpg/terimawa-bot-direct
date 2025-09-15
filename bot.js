const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

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
    DB_ACCOUNT_ID,    
    TERIMAWA_BOT_ID,  
    VALUE             
} = process.env;


// --- FUNGSI UTAMA (ROUTER) ---
async function main() {
    if (!TERIMAWA_USERNAME || !TERIMAWA_PASSWORD) {
        console.error("❌ Error: Kredensial TERIMAWA_USERNAME atau TERIMAWA_PASSWORD tidak diatur.");
        await sendResultToCallback({ status: 'error', message: 'Kredensial TerimaWA tidak diatur.' });
        process.exit(1);
    }
     if (!DB_ACCOUNT_ID) {
        console.error("❌ Error: DB_ACCOUNT_ID tidak diatur. Proses callback tidak akan berhasil.");
        process.exit(1);
    }

    console.log(`🚀 Menjalankan aksi: ${ACTION}`);

    switch (ACTION) {
        case 'get_qr':
            await getQr();
            break;
        case 'get_pairing_code':
            await getPairingAndPollForConnection(PHONE_NUMBER);
            break;
        case 'set_mode':
            await manageBot('mode', TERIMAWA_BOT_ID, VALUE);
            break;
        case 'set_blasting':
            await manageBot('blasting', TERIMAWA_BOT_ID, VALUE);
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

// --- FUNGSI LOGIN BARU UNTUK MATH CAPTCHA ---
async function loginAndGetPage(browser) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
    
    console.log(`2. Membuka halaman login: ${LOGIN_PAGE_URL}`);
    await page.goto(LOGIN_PAGE_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    
    console.log("3. Mengisi form login...");
    await page.type('input#username', TERIMAWA_USERNAME);
    await page.type('input#password', TERIMAWA_PASSWORD);

    // --- LOGIKA BARU UNTUK MENYELESAIKAN CAPTCHA MATEMATIKA ---
    console.log("4. Menyelesaikan captcha matematika...");
    await page.waitForSelector('#mathQuestion');
    const questionText = await page.$eval('#mathQuestion', el => el.textContent); // Contoh: "26 + 33 = ?"
    
    const cleanQuestion = questionText.replace('=', '').replace('?', '').trim(); // "26 + 33"
    const parts = cleanQuestion.split(' '); // ["26", "+", "33"]
    
    const num1 = parseInt(parts[0], 10);
    const operator = parts[1];
    const num2 = parseInt(parts[2], 10);
    
    let answer;
    if (operator === '+') {
        answer = num1 + num2;
    } else if (operator === '-') {
        answer = num1 - num2;
    } else if (operator === '*') {
        answer = num1 * num2;
    } else {
        throw new Error(`Operator matematika tidak dikenal: ${operator}`);
    }
    
    console.log(`   ✅ Soal: ${questionText} Jawaban: ${answer}`);
    
    await page.type('input#mathAnswer', String(answer));
    
    console.log("5. Mengklik tombol login...");
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
        page.click('button#loginBtn')
    ]);

    if (!page.url().startsWith(SUCCESS_URL_REDIRECT)) {
        throw new Error(`Gagal login. URL saat ini: ${page.url()}. Pastikan jawaban captcha benar.`);
    }
    
    console.log(`   ✅ Login berhasil secara otomatis!`);
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
    const callbackPayload = { ...payload, secret: CALLBACK_SECRET, db_account_id: DB_ACCOUNT_ID };
    
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

// --- FUNGSI POLLING KONEKSI ---
async function pollForConnection(page, phoneNumber) {
    console.log(`🔄 Memulai polling untuk nomor: ${phoneNumber}`);
    for (let i = 0; i < 45; i++) { 
        await page.waitForTimeout(2000);
        
        try {
            console.log(`   ...mencari bot ${phoneNumber}... (percobaan ${i + 1})`);
            await page.reload({ waitUntil: 'networkidle0' });

            const botLiXPath = `//li[.//span[contains(text(), "Terhubung")] and contains(., "${phoneNumber}")]`;
            const [botLi] = await page.$x(botLiXPath);

            if (botLi) {
                const botIdElement = await botLi.$('select[onchange^="updateBotSetting"]');
                const botIdRaw = await botIdElement.evaluate(el => el.getAttribute('onchange'));
                const botIdMatch = botIdRaw.match(/updateBotSetting\((\d+),/);
                
                if (botIdMatch && botIdMatch[1]) {
                    const terimawaBotId = botIdMatch[1];
                    console.log(`   ✅ Bot terhubung! Nomor: ${phoneNumber}, ID TerimaWA: ${terimawaBotId}`);
                    return {
                        status: 'connected',
                        phone_number: phoneNumber,
                        bot_id: terimawaBotId
                    };
                }
            }
        } catch (e) {
            console.log(`   ⚠️ Terjadi error kecil saat polling, mencoba lagi...`);
        }
    }
    throw new Error(`Waktu habis saat menunggu koneksi untuk nomor ${phoneNumber}.`);
}

// --- FUNGSI-FUNGSI AKSI ---

async function getQr() {
    let browser = null;
    try {
        browser = await launchBrowser();
        const page = await loginAndGetPage(browser);

        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });
        await page.click("button#addBotBtn");
        await page.waitForSelector('#addBotModal:not(.hidden)');
        await page.click("button#addBotSubmit");

        const qrImageSelector = 'img#qrCodeImage';
        await page.waitForSelector(qrImageSelector, { timeout: 60000, visible: true });
        const qrCodeSrc = await page.$eval(qrImageSelector, img => img.src);

        if (!qrCodeSrc) throw new Error('Gagal mendapatkan QR Code.');

        console.log("   ✅ QR Code didapatkan. Mengirim ke callback.");
        await sendResultToCallback({ status: 'success', type: 'qr', data: qrCodeSrc });

    } catch (error) {
        console.error("❌ Terjadi error saat proses QR:", error.message);
        await sendResultToCallback({ status: 'error', message: error.message || 'Gagal total saat proses QR.' });
    } finally {
        if (browser) await browser.close();
    }
}

async function getPairingAndPollForConnection(phoneNumber) {
    if (!phoneNumber) {
        await sendResultToCallback({ status: 'error', message: 'Nomor HP wajib untuk pairing code.' });
        return;
    }
    let browser = null;
    try {
        browser = await launchBrowser();
        const page = await loginAndGetPage(browser);

        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });
        await page.click("button#addBotBtn");

        await page.waitForSelector('#addBotModal:not(.hidden)');
        await page.click("input[name='connectionMethod'][value='pairing']");
        
        await page.waitForSelector('input#phoneNumber', { visible: true });
        await page.type('input#phoneNumber', phoneNumber);

        await page.click("button#addBotSubmit");

        const pairingCodeXPath = "//div[contains(@class, 'font-mono')]";
        await page.waitForXPath(pairingCodeXPath, { timeout: 60000, visible: true });
        const [pairingCodeElement] = await page.$x(pairingCodeXPath);
        const pairingCodeText = await page.evaluate(el => el.textContent.trim(), pairingCodeElement);

        if (!pairingCodeText) throw new Error('Gagal mendapatkan teks Pairing Code.');
        
        console.log(`   ✅ Pairing Code didapatkan: ${pairingCodeText}. Mengirim ke callback...`);
        await sendResultToCallback({ status: 'success', type: 'pairing_code', data: pairingCodeText });

        console.log("⏳ Menunggu pengguna memasukkan pairing code dan bot terhubung...");
        const connectionResult = await pollForConnection(page, phoneNumber);
        
        await sendResultToCallback({ 
            status: 'success', 
            type: 'connected', 
            data: 'Bot terhubung via polling.',
            phone_number: connectionResult.phone_number,
            bot_id: connectionResult.bot_id
        });

    } catch (error) {
        console.error("❌ Terjadi error saat proses Pairing:", error.message);
        await sendResultToCallback({ status: 'error', message: error.message || 'Gagal total saat proses Pairing.' });
    } finally {
        if (browser) await browser.close();
    }
}

// --- FUNGSI MANAJEMEN BOT (DENGAN LOGIKA BARU DAN LEBIH PINTAR) ---
async function manageBot(settingType, terimawaBotId, value) {
    if (!terimawaBotId || value === undefined) {
        await sendResultToCallback({ status: 'error', message: 'ID Bot TerimaWA atau Value tidak disediakan.' });
        return;
    }
    let browser = null;
    try {
        browser = await launchBrowser();
        const page = await loginAndGetPage(browser);

        console.log(`5. Menavigasi ke halaman Bots: ${BOTS_PAGE_URL}`);
        await page.goto(BOTS_PAGE_URL, { waitUntil: 'networkidle0' });

        const botContainerXPath = 
            `//li[.//select[contains(@onchange, "updateBotSetting(${terimawaBotId},")] and .//span[contains(text(), "Terhubung")]]`;
        
        console.log(`6. Mencari container untuk bot AKTIF dengan ID: ${terimawaBotId}`);
        const [botContainer] = await page.$x(botContainerXPath);
        
        if (!botContainer) {
            throw new Error(`Container untuk bot AKTIF dengan ID ${terimawaBotId} tidak ditemukan. Pastikan bot terhubung.`);
        }
        console.log("   ✅ Container bot aktif ditemukan.");

        if (settingType === 'mode') {
            console.log(`7. Mengubah Mode untuk Bot ID ${terimawaBotId} ke value ${value}`);
            const modeSelect = await botContainer.$('select[onchange*="updateBotSetting"]');
            await modeSelect.select(value);
            console.log(`   ✅ Mode berhasil diubah.`);
            
        } else if (settingType === 'blasting') {
            console.log(`7. Mencari tombol Blast/Stop di dalam container bot.`);
            const blastButton = await botContainer.$('button[onclick*="updateBotSending"]');

            if (!blastButton) {
                 throw new Error(`Tombol Blast/Stop untuk bot ${terimawaBotId} tidak ditemukan di dalam container.`);
            }
            
            const buttonText = await blastButton.evaluate(el => el.textContent.trim());
            console.log(`   ✅ Tombol ditemukan dengan teks: "${buttonText}". Mengklik tombol...`);
            await blastButton.click();
        }
        
        console.log("   ...menunggu 3 detik agar perubahan diproses oleh server terimawa.com...");
        await page.waitForTimeout(3000); 

        await sendResultToCallback({ status: 'success', type: 'management', message: `Aksi ${settingType} berhasil.` });

    } catch (error) {
        console.error(`❌ Terjadi error saat manajemen bot:`, error.message);
        await sendResultToCallback({ status: 'error', message: error.message || 'Gagal total saat manajemen bot.' });
    } finally {
        if (browser) await browser.close();
    }
}


// --- JALANKAN FUNGSI UTAMA ---
main();
