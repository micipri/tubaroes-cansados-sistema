<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["error" => "Method not allowed"]);
    exit();
}

$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!isset($data['image']) || !isset($data['id'])) {
    http_response_code(400);
    echo json_encode(["error" => "Missing image or ID"]);
    exit();
}

$base64Image = $data['image'];
$athleteId = $data['id'];

// Remove the "data:image/jpeg;base64," part
$imageParts = explode(";base64,", $base64Image);
if (count($imageParts) !== 2) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid image format"]);
    exit();
}

$imageTypeAux = explode("image/", $imageParts[0]);
$imageType = $imageTypeAux[1] ?? 'jpg';
$imageBase64 = base64_decode($imageParts[1]);

$uploadDir = __DIR__ . '/uploads/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}

// Sanitize filename
$fileName = "atleta_" . preg_replace('/[^a-zA-Z0-9_-]/', '', $athleteId) . "." . $imageType;
$filePath = $uploadDir . $fileName;

if (file_put_contents($filePath, $imageBase64)) {
    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "Image saved successfully",
        "url" => "uploads/" . $fileName
    ]);
} else {
    http_response_code(500);
    echo json_encode(["error" => "Failed to save image"]);
}
?>
