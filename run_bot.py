# Versi Final v2.1 - Menggabungkan semua perbaikan
import requests
import re
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
import time
import os

# --- KONFIGURASI ---
LOGIN_PAGE_URL = "https://app.terimawa.com/login"
# URL tujuan SETELAH login berhasil (sesuai info Anda)
SUCCESS_URL_REDIRECT = "https://app.terimawa.com/"
BOTS_PAGE_URL = "https://app.terimawa.com/bots"
API_URL = "https://app.terimawa.com/api/bots"

# --- MENGAMBIL KREDENSIAL DARI GITHUB SECRETS ---
CREDENTIALS = {
    "username": os.getenv("TERIMAWA_USERNAME"),
    "password": os.getenv("TERIMAWA_PASSWORD")
}

def login_and_get_authenticated_session(playwright):
    """
    Fungsi ini melakukan login dan mengembalikan 'page' object yang sudah terotentikasi.
    """
    if not CREDENTIALS["username"] or not CREDENTIALS["password"]:
        raise Exception("Error: TERIMAWA_USERNAME atau TERIMAWA_PASSWORD tidak ditemukan di GitHub Secrets.")

    print("1. Meluncurkan browser dan melakukan login...")
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    )
    page = context.new_page()

    try:
        page.goto(LOGIN_PAGE_URL, timeout=60000)
        
        print("   Mengisi form...")
        page.fill('input[name="username"]', CREDENTIALS["username"])
        page.fill('input[name="password"]', CREDENTIALS["password"])
        
        print("   Mengklik tombol login...")
        page.click('button[type="submit"]')
        
        print(f"   Menunggu pengalihan ke {SUCCESS_URL_REDIRECT}...")
        page.wait_for_url(SUCCESS_URL_REDIRECT, timeout=30000)
        
        # Cek sekali lagi untuk memastikan tidak kembali ke halaman login
        if "/login" in page.url():
             raise Exception("Gagal login, kemungkinan username atau password salah atau ada halaman verifikasi.")

        print(f"   ✅ Login Berhasil. URL saat ini: {page.url()}")
        return page, browser
        
    except Exception as e:
        print(f"   ❌ Gagal pada tahap login: {e}")
        if browser:
            browser.close()
        return None, None

def get_qr_code():
    """
    Fungsi untuk mengambil QR Code.
    """
    print("\n====== Memulai Proses Pengambilan QR Code ======")
    with sync_playwright() as p:
        page, browser = login_and_get_authenticated_session(p)
        if not page:
            return

        try:
            print("2. Menavigasi ke halaman WhatsApp Bots...")
            page.goto(BOTS_PAGE_URL, timeout=60000)

            print("3. Mengklik tombol 'Tambah WhatsApp'...")
            page.click('#addBotBtn')

            print("4. Mengklik tombol 'Lanjut' untuk metode QR Code...")
            with page.expect_response(API_URL) as response_info:
                page.click('#addBotSubmit')
            
            response = response_info.value
            result = response.json()

            if result.get("error") == "0" and result.get("msg"):
                qr_data_url = result["msg"]
                session_name = result.get("session")
                print("\n   ✅ QR Code Berhasil Didapatkan!")
                print(f"   Session ID: {session_name}")
                print("\n   Salin teks di bawah ini dan tempel di browser untuk melihat QR Code:")
                print("   ---------------------------------------------------------------")
                print(f"   {qr_data_url}")
                print("   ---------------------------------------------------------------")
            else:
                print(f"\n   ❌ GAGAL: {result.get('msg', 'Error tidak diketahui dari API.')}")

        except PlaywrightTimeoutError as e:
            print(f"\n   ❌ GAGAL: Proses timeout. Mungkin halaman terlalu lama dimuat atau selector tidak ditemukan. Error: {e}")
        except Exception as e:
            print(f"\n   ❌ Terjadi error tak terduga: {e}")
            if page:
                page.screenshot(path='error_screenshot.png')
                print("   Screenshot error disimpan sebagai 'error_screenshot.png'.")
        finally:
            if browser:
                print("5. Menutup browser...")
                browser.close()

def get_pairing_code(phone_number):
    """
    Fungsi untuk mengambil Pairing Code.
    """
    print("\n====== Memulai Proses Pengambilan Pairing Code ======")
    with sync_playwright() as p:
        page, browser = login_and_get_authenticated_session(p)
        if not page:
            return

        try:
            print(f"2. Menavigasi ke halaman WhatsApp Bots...")
            page.goto(BOTS_PAGE_URL, timeout=60000)

            print("3. Mengklik tombol 'Tambah WhatsApp'...")
            page.click('#addBotBtn')

            print("4. Memilih metode 'Pairing Code' dan mengisi nomor telepon...")
            page.click('input[name="connectionMethod"][value="pairing"]')
            page.fill('#phoneNumber', phone_number)
            
            print("5. Mengklik tombol 'Lanjut' untuk metode Pairing Code...")
            with page.expect_response(API_URL) as response_info:
                page.click('#addBotSubmit')
            
            response = response_info.value
            result = response.json()

            if result.get("error") == "0" and result.get("msg"):
                pairing_code = result["msg"]
                session_name = result.get("session")
                formatted_code = f"{pairing_code[:4]}-{pairing_code[4:]}" if len(pairing_code) == 8 else pairing_code
                print("\n   ✅ Pairing Code Berhasil Didapatkan!")
                print(f"   Session ID: {session_name}")
                print("   ---------------------------------------------------------------")
                print(f"   Kode Pairing Anda: {formatted_code}")
                print("   ---------------------------------------------------------------")
            else:
                print(f"\n   ❌ GAGAL: {result.get('msg', 'Error tidak diketahui dari API.')}")
        
        except PlaywrightTimeoutError as e:
            print(f"\n   ❌ GAGAL: Proses timeout. Mungkin halaman terlalu lama dimuat atau selector tidak ditemukan. Error: {e}")
        except Exception as e:
            print(f"\n   ❌ Terjadi error tak terduga: {e}")
            if page:
                page.screenshot(path='error_screenshot.png')
                print("   Screenshot error disimpan sebagai 'error_screenshot.png'.")
        finally:
            if browser:
                print("6. Menutup browser...")
                browser.close()

if __name__ == "__main__":
    print("Memulai bot...")
    
    # --- PENGATURAN EKSEKUSI ---
    # Saat ini, skrip akan mencoba mendapatkan QR Code.
    
    # >> Untuk mendapatkan QR Code <<
    get_qr_code()
    
    # >> Untuk mendapatkan Pairing Code, beri komentar pada get_qr_code() di atas,
    #    dan hapus komentar pada dua baris di bawah ini.
    # print("\n" + "="*60 + "\n")
    # phone_number_for_pairing = "6281234567890" # <-- Ganti dengan nomor yang valid
    # get_pairing_code(phone_number_for_pairing)            print(f"2. Menavigasi ke halaman WhatsApp Bots untuk nomor {phone_number}...")
            page.goto(BOTS_PAGE_URL, timeout=60000)

            print("3. Mengklik tombol 'Tambah WhatsApp'...")
            page.click('#addBotBtn')

            print("4. Memilih metode 'Pairing Code' dan mengisi nomor telepon...")
            page.click('input[name="connectionMethod"][value="pairing"]')
            page.fill('#phoneNumber', phone_number)
            
            print("5. Mengklik tombol 'Lanjut' untuk metode Pairing Code...")
            with page.expect_response(API_URL) as response_info:
                page.click('#addBotSubmit')
            
            response = response_info.value
            result = response.json()

            if result.get("error") == "0" and result.get("msg"):
                pairing_code = result["msg"]
                session_name = result.get("session")
                formatted_code = f"{pairing_code[:4]}-{pairing_code[4:]}" if len(pairing_code) == 8 else pairing_code
                print("\n   ✅ Pairing Code Berhasil Didapatkan!")
                print(f"   Session ID: {session_name}")
                print("   ---------------------------------------------------------------")
                print(f"   Kode Pairing Anda: {formatted_code}")
                print("   ---------------------------------------------------------------")
            else:
                print(f"\n   ❌ GAGAL: {result.get('msg', 'Error tidak diketahui dari API.')}")
        
        except PlaywrightTimeoutError:
            print("\n   ❌ GAGAL: Proses timeout. Mungkin halaman terlalu lama dimuat.")
        except Exception as e:
            print(f"\n   ❌ Terjadi error tak terduga: {e}")
        finally:
            if browser:
                print("6. Menutup browser...")
                browser.close()

if __name__ == "__main__":
    print("Memulai bot...")
    
    # --- CONTOH PENGGUNAAN ---
    # Saat ini skrip akan mencoba mendapatkan QR Code.
    # Jika ingin Pairing Code, beri komentar pada get_qr_code() dan hapus komentar pada get_pairing_code()
    get_qr_code()

    # print("\n" + "="*60 + "\n")
    
    # phone_number_for_pairing = "6281234567890" # <-- Ganti dengan nomor yang valid
    # get_pairing_code(phone_number_for_pairing)
