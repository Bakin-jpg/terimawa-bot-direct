const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

// Ambil kredensial dari GitHub Secrets yang aman
const { TERIMAWA_USERNAME, TERIMAWA_PASSWORD } = process.env;

async function getQrCode() {
    if (!TERIMAWA_USERNAME || !TERIMAWA_PASSWORD) {
        console.error("❌ Error: Pastikan TERIMAWA_USERNAME dan TERIMAWA_PASSWORD sudah diatur di GitHub Secrets.");
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
            // Kita tidak lagi butuh proxy, jadi tidak ada args proxy di sini
        });

        const page = await browser.newPage();

        console.log("2. Membuka halaman login https://app.terimawa.com/login...");
        await page.goto('https://app.terimawa.com/login', { waitUntil: 'networkidle0', timeout: 60000 });

        console.log("3. Mengisi form login...");
        await page.type('input[name="username"]', TERIMAWA_USERNAME);
        await page.type('input[name="password"]', TERIMAWA_PASSWORD);

        console.log("4. Mengklik tombol login dan menunggu navigasi...");
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
            page.click('button[type="submit"]')
        ]);
        
        console.log("   ✅ Login berhasil. URL saat ini:", page.url());

        console.log("5. Menavigasi ke halaman tambah WhatsApp...");
        await page.goto('https://app.terimawa.com/whatsapp/create', { waitUntil: 'networkidle0' });

        console.log("6. Mengklik tombol untuk menghasilkan QR Code...");
        await page.click('button:has-text("Buat Koneksi")'); // Tombol ini mungkin berbeda, sesuaikan jika perlu

        console.log("7. Menunggu QR Code muncul dan mengambil datanya...");
        await page.waitForSelector('canvas', { timeout: 30000 });

        const qrCodeDataUrl = await page.evaluate(() => {
            const canvas = document.querySelector('canvas');
            return canvas ? canvas.toDataURL('image/png') : null;
        });

        if (!qrCodeDataUrl) {
            throw new Error("Tidak dapat menemukan elemen canvas untuk QR Code.");
        }

        console.log("\n\n✅✅✅ QR CODE BERHASIL DIAMBIL! ✅✅✅");
        console.log("Salin semua teks di bawah ini (mulai dari 'data:image/png...') dan tempel di address bar browser Anda untuk melihat QR Code:\n");
        
        // Mencetak data URL ke log agar bisa disalin oleh pengguna
        console.log(qrCodeDataUrl);

    } catch (error) {
        console.error("❌ Terjadi error selama proses:", error.message);
        // Ambil screenshot jika terjadi error untuk debugging
        if (browser && page) {
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
