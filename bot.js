<?php
/**
 * =================================================================
 * API.PHP (VERSI BARU - POLLING BERBASIS FILE)
 * =================================================================
 * File ini memiliki DUA FUNGSI UTAMA:
 *
 * 1. JIKA DIPANGGIL DENGAN METODE 'POST' (oleh bot.js):
 *    - Bertindak sebagai CALLBACK.
 *    - Menerima data (QR, Pairing, status, error) dari bot.
 *    - MENULIS status ke sebuah file sementara yang unik (e.g., status_files/sess_xxx.json).
 *    - HANYA jika status 'connected', ia akan MENULIS ke database.
 *
 * 2. JIKA DIPANGGIL DENGAN METODE 'GET' (oleh index.php):
 *    - Bertindak sebagai PEMERIKSA STATUS (Polling).
 *    - MEMBACA file status sementara yang sesuai.
 *    - Mengirimkan isinya ke JavaScript dan kemudian menghapus file tersebut.
 * =================================================================
 */

// Selalu set header ke JSON karena file ini adalah API
header('Content-Type: application/json');

// Selalu butuh koneksi database
require_once 'db.php';

// Definisikan direktori untuk menyimpan file status sementara
define('STATUS_DIR', __DIR__ . '/status_files/');

// Cek dan buat direktori jika belum ada
if (!is_dir(STATUS_DIR)) {
    // Coba buat direktori, @ untuk menekan warning jika direktori sudah ada (race condition)
    if (!@mkdir(STATUS_DIR, 0755, true) && !is_dir(STATUS_DIR)) {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'Gagal membuat direktori status. Periksa izin folder.']);
        exit;
    }
}

// =========================================================================
// BAGIAN 1: LOGIKA CALLBACK (Jika permintaan adalah POST dari bot.js)
// =========================================================================
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    
    // Ambil 'secret key' dari environment atau definisikan di sini
    $expected_secret = getenv('CALLBACK_SECRET') ?: 'RAHASIA_SUPER_AMAN_12345'; // WAJIB GANTI DENGAN SECRET ANDA

    // Ambil data mentah yang dikirim oleh bot.js
    $input_json = file_get_contents('php://input');
    $data = json_decode($input_json, true);

    // Validasi Keamanan & Data Penting
    if (
        !$data ||
        !isset($data['secret']) ||
        $data['secret'] !== $expected_secret ||
        !isset($data['session_id']) ||
        !isset($data['user_id'])
    ) {
        http_response_code(403); // Forbidden
        echo json_encode(['status' => 'error', 'message' => 'Akses ditolak atau data tidak lengkap.']);
        exit;
    }

    $session_id = $data['session_id'];
    $user_id = $data['user_id'];
    
    // Keamanan: Pastikan session_id tidak mengandung karakter aneh (mencegah path traversal)
    if (preg_match('/[^a-zA-Z0-9_.]/', $session_id)) {
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Format Session ID tidak valid.']);
        exit;
    }
    
    $filename = STATUS_DIR . $session_id . '.json';

    // Jika bot berhasil terhubung sepenuhnya, baru kita INSERT ke database
    if (isset($data['type']) && $data['type'] === 'connected') {
        try {
            // HANYA saat 'connected' kita menulis ke database
            $stmt = $pdo->prepare(
                "INSERT INTO whatsapp_accounts (user_id, phone_number, status, terimawa_bot_id) VALUES (?, ?, 'active', ?)"
            );
            $stmt->execute([
                $user_id,
                $data['phone_number'] ?? null,
                $data['bot_id'] ?? null
            ]);
        } catch (PDOException $e) {
            // Jika gagal insert, ubah data menjadi pesan error untuk disimpan ke file
            $data = [
                'status' => 'error',
                'message' => 'Koneksi WA berhasil, tetapi gagal menyimpan ke database. Hubungi admin.'
            ];
            error_log("Database INSERT Error on api.php (POST): " . $e->getMessage());
        }
    }
    
    // Apapun hasilnya (qr, pairing, connected, error), simpan status ke file sementara
    // agar proses polling di frontend bisa membacanya.
    file_put_contents($filename, json_encode($data));
    
    http_response_code(200);
    echo json_encode(['status' => 'ok', 'message' => 'Callback diterima.']);
    exit;
}

// =========================================================================
// BAGIAN 2: LOGIKA POLLING (Jika permintaan adalah GET dari index.php)
// =========================================================================
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'check_status') {
    
    session_start();

    // Validasi Keamanan & Input
    if (!isset($_SESSION['loggedin']) || !isset($_GET['session_id'])) {
        http_response_code(403);
        echo json_encode(['status' => 'error', 'message' => 'Akses tidak sah atau session_id tidak ditemukan.']);
        exit;
    }

    $session_id = $_GET['session_id'];

    // Keamanan: Validasi format session_id
    if (preg_match('/[^a-zA-Z0-9_.]/', $session_id)) {
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Format Session ID tidak valid.']);
        exit;
    }

    $filename = STATUS_DIR . $session_id . '.json';
    
    if (file_exists($filename)) {
        // Jika file ditemukan, baca isinya, kirim ke browser, lalu hapus
        $content = file_get_contents($filename);
        echo $content;
        
        // Hapus file setelah dibaca agar tidak menumpuk dan tidak dibaca lagi
        unlink($filename);
    } else {
        // Jika file belum ada, berarti bot masih bekerja.
        echo json_encode(['status' => 'pending']);
    }
    exit;
}

// =========================================================================
// JIKA TIDAK ADA KONDISI YANG COCOK
// =========================================================================
http_response_code(404);
echo json_encode(['error' => 'Endpoint tidak ditemukan.']);
?>```
