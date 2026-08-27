import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absoluteUrl, isAllowedRequestOrigin, isAllowedScrapeUrl, isLocalOrigin, isLoopbackHost, resolveListenConfig } from './net.ts';

test('scrape guard allows the stores we actually scrape', () => {
  assert.equal(isAllowedScrapeUrl('https://arcadia.co.il/product/elden-ring'), true);
  assert.equal(isAllowedScrapeUrl('https://www.gamestorm.co.il/p/123'), true);
  assert.equal(isAllowedScrapeUrl('https://vgs.co.il/?p=9'), true);
  assert.equal(isAllowedScrapeUrl('http://player1.co.il/x'), true);
  assert.equal(isAllowedScrapeUrl('https://www.ivory.co.il/catalog.php?id=140036'), true);
  assert.equal(isAllowedScrapeUrl('https://www.bug.co.il/brand/ps5/elden-ring'), true);
});

test('scrape guard blocks SSRF targets planted in a shared file', () => {
  assert.equal(isAllowedScrapeUrl('http://169.254.169.254/latest/meta-data/'), false); // cloud metadata
  assert.equal(isAllowedScrapeUrl('http://127.0.0.1:6379/'), false); // local redis
  assert.equal(isAllowedScrapeUrl('http://localhost/admin'), false);
  assert.equal(isAllowedScrapeUrl('http://192.168.1.1/'), false); // LAN router
  assert.equal(isAllowedScrapeUrl('https://arcadia.co.il.attacker.com/'), false); // look-alike host
});

test('scrape guard blocks non-http schemes', () => {
  assert.equal(isAllowedScrapeUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedScrapeUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedScrapeUrl('data:text/html,<script>'), false);
  assert.equal(isAllowedScrapeUrl('not a url'), false);
});

test('CSRF guard: same-machine origins (and no origin) pass', () => {
  assert.equal(isLocalOrigin(undefined), true); // curl / server-side / same-origin GET
  assert.equal(isLocalOrigin(''), true);
  assert.equal(isLocalOrigin('http://localhost:5173'), true); // the app (dev)
  assert.equal(isLocalOrigin('http://localhost:5174'), true);
  assert.equal(isLocalOrigin('http://127.0.0.1:5173'), true);
  assert.equal(isLocalOrigin('http://[::1]:5173'), true);
});

test('CSRF guard: cross-site origins are rejected', () => {
  assert.equal(isLocalOrigin('https://evil.com'), false);
  assert.equal(isLocalOrigin('https://localhost.evil.com'), false); // look-alike
  assert.equal(isLocalOrigin('http://169.254.169.254'), false);
  assert.equal(isLocalOrigin('null'), false); // sandboxed-iframe Origin
});

test('CSRF guard (deployed): the origin serving the app passes, everything else stays out', () => {
  const HOST = 'vgpt-demo.onrender.com';
  // These are DEPLOYED cases, so they say so. The third argument used to be
  // implicit and defaulted to "not production", which is correct for the tests
  // and wrong for what this case is describing — it only passed because local
  // mode used to accept any Origin whose host matched the Host header, and that
  // is exactly the DNS-rebinding hole now closed.
  const deployed = (origin, host) => isAllowedRequestOrigin(origin, host, true);

  // The deployed app itself: Origin host === the Host the request was sent to.
  assert.equal(deployed('https://vgpt-demo.onrender.com', HOST), true);
  // Everyone else is still CSRF: evil.com can't forge a matching Host.
  assert.equal(deployed('https://evil.com', HOST), false);
  assert.equal(deployed('https://vgpt-demo.onrender.com.evil.com', HOST), false);
  // A port mismatch is a different origin, not "close enough".
  assert.equal(deployed('https://vgpt-demo.onrender.com:8443', HOST), false);
  // Dev is unchanged: Vite on another localhost port, or no Origin at all.
  assert.equal(isAllowedRequestOrigin('http://localhost:5173', 'localhost:5174'), true);
  assert.equal(deployed(undefined, HOST), true);
  // A missing Host header can never authorize a cross-site origin.
  assert.equal(deployed('https://evil.com', undefined), false);
});

test('a stray PORT in the dev environment never moves the API off 5174', () => {
  // The real incident: the dev harness exported PORT=5173 for the WEB server;
  // the API inherited it, left 5174, and every request through the Vite proxy
  // died with ECONNREFUSED — the app looked like it had lost all its data.
  assert.deepEqual(resolveListenConfig({ PORT: '5173' }), {
    port: 5174,
    host: '127.0.0.1',
    production: false,
  });
  // Dev also never exposes the no-auth API beyond loopback.
  assert.equal(resolveListenConfig({}).host, '127.0.0.1');
});

test('a real deployment takes the platform port and binds publicly', () => {
  assert.deepEqual(resolveListenConfig({ NODE_ENV: 'production', PORT: '10000' }), {
    port: 10000,
    host: '0.0.0.0',
    production: true,
  });
  // Production without a platform port still serves on the default.
  assert.equal(resolveListenConfig({ NODE_ENV: 'production' }).port, 5174);
});

test('VGPT_PORT is the explicit override, in either mode', () => {
  assert.equal(resolveListenConfig({ VGPT_PORT: '8790' }).port, 8790);
  assert.equal(resolveListenConfig({ VGPT_PORT: '8790', PORT: '5173' }).port, 8790);
  assert.equal(resolveListenConfig({ NODE_ENV: 'production', VGPT_PORT: '9000', PORT: '10000' }).port, 9000);
  // Garbage falls back rather than binding port NaN/0 (a random free port).
  assert.equal(resolveListenConfig({ VGPT_PORT: 'abc' }).port, 5174);
  assert.equal(resolveListenConfig({ NODE_ENV: 'production', PORT: '0' }).port, 5174);
});

test('absoluteUrl joins bare-relative hrefs without welding them onto the host', () => {
  // "BASE + href" produced "https://www.bug.co.ilproduct/1" — a sourceGameId
  // that 404s on every later wishlist refresh.
  assert.equal(absoluteUrl('https://www.bug.co.il', 'product/1'), 'https://www.bug.co.il/product/1');
  assert.equal(absoluteUrl('https://www.bug.co.il', '/product/1'), 'https://www.bug.co.il/product/1');
  assert.equal(
    absoluteUrl('https://www.bug.co.il', 'https://www.bug.co.il/product/1'),
    'https://www.bug.co.il/product/1'
  );
});

/* ── DNS rebinding ───────────────────────────────────────────────────────── */

test('a rebound hostname cannot pass the CSRF gate', async () => {
  // The attack the Origin check alone did not stop: evil.com resolves to
  // 127.0.0.1, so the victim's browser genuinely reaches this server, and the
  // attacker controls BOTH halves of "does Origin's host equal the Host
  // header" — they simply make them match. The Host header is the one thing
  // they cannot make say "localhost" while still landing on the victim's
  // machine, so local mode now requires it.
  assert.equal(
    isAllowedRequestOrigin('http://evil.com:5174', 'evil.com:5174', false),
    false,
    'a matching but non-loopback Host must not be enough'
  );
  assert.equal(isAllowedRequestOrigin('http://evil.com', 'evil.com', false), false);
});

test('the app itself still passes in local mode', async () => {
  // The Vite dev server on 5173 talking to the API on 5174, and the built app
  // served from the API itself.
  assert.equal(isAllowedRequestOrigin('http://localhost:5173', 'localhost:5174', false), true);
  assert.equal(isAllowedRequestOrigin('http://127.0.0.1:5174', '127.0.0.1:5174', false), true);
  // curl and anything server-side send no Origin at all.
  assert.equal(isAllowedRequestOrigin(undefined, 'localhost:5174', false), true);
});

test('an ordinary cross-site POST is still rejected', async () => {
  assert.equal(isAllowedRequestOrigin('https://evil.example', 'localhost:5174', false), false);
});

test('a deployment keeps matching on its own hostname', async () => {
  // A real deployment has a real name and serves the app itself, so the app's
  // Origin equals the Host it was addressed to.
  assert.equal(isAllowedRequestOrigin('https://prices.example', 'prices.example', true), true);
  assert.equal(isAllowedRequestOrigin('https://evil.example', 'prices.example', true), false);
});

test('loopback host recognition covers the shapes a browser sends', async () => {
  assert.equal(isLoopbackHost('localhost:5174'), true);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('[::1]:5174'), true);
  assert.equal(isLoopbackHost('LOCALHOST:5174'), true);
  assert.equal(isLoopbackHost('evil.com:5174'), false);
  assert.equal(isLoopbackHost('192.168.1.10:5174'), false);
  assert.equal(isLoopbackHost(undefined), false);
});
