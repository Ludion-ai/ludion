<?php
declare(strict_types=1);
require __DIR__ . '/../src/response.php';

foreach ([
    '/health' => ['code' => 200, 'body' => ['status' => 'ok']],
    '/' => ['code' => 200, 'body' => ['message' => 'Hello from Ludion', 'encoding' => '日本語']],
    '/missing' => ['code' => 404, 'body' => ['error' => 'not_found']],
] as $path => $expected) {
    $actual = responseFor($path);
    if ($actual !== $expected || json_decode(json_encode($actual, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR) !== $expected) {
        fwrite(STDERR, "Response contract failed: {$path}\n");
        exit(1);
    }
}
echo "Response and JSON contracts passed.\n";
