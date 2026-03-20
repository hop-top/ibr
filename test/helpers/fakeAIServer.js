import http from 'node:http';

/**
 * OpenAI-compatible HTTP server for CLI-level e2e tests.
 * Pops responses from queue in order; returns 500 when exhausted.
 *
 * @param {string[]} responses - Ordered list of content strings to return
 * @returns {Promise<{ baseUrl: string, close: () => void }>}
 */
export function startFakeAIServer(responses) {
  const queue = [...responses];

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (queue.length === 0) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'no more responses' }));
          return;
        }

        const content = queue.shift();
        const payload = {
          id: 'test',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
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
