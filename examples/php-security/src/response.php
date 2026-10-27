<?php
declare(strict_types=1);

function responseFor(string $path): array {
    return match ($path) {
        '/health' => ['code' => 200, 'body' => ['status' => 'ok']],
        '/' => ['code' => 200, 'body' => ['message' => 'Hello from Ludion', 'encoding' => '日本語']],
        default => ['code' => 404, 'body' => ['error' => 'not_found']],
    };
}
