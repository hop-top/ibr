import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/html');

/**
 * Start a static HTTP server that serves files from test/fixtures/html/.
 * Binds to OS-assigned port 0.
 *
 * @returns {Promise<{ baseUrl: string, close: () => void }>}
 */
export function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const filename = path.basename(req.url.split('?')[0]);
      const filePath = path.join(FIXTURES_DIR, filename);

      if (!filename || !fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => server.close(r)),
      });
    });

    server.on('error', reject);
  });
}
