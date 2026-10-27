<?php
declare(strict_types=1);
require __DIR__ . '/../vendor/autoload.php';
$request = Symfony\Component\HttpFoundation\Request::create('/hello?name=Ludion');
if ($request->query->get('name') !== 'Ludion' || $request->getPathInfo() !== '/hello') {
    fwrite(STDERR, "Application request contract failed.\n"); exit(1);
}
$response = new Symfony\Component\HttpFoundation\JsonResponse(['message' => '日本語']);
if (json_decode($response->getContent(), true, 512, JSON_THROW_ON_ERROR) !== ['message' => '日本語']) exit(1);
echo "Request and response contracts passed.\n";
