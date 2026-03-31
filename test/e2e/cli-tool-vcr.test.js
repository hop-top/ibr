/**
 * VCR E2E tests for `ibr tool` subcommand (T-0007..T-0010).
 *
 * Each test runs a tool invocation against a fake AI server (replaying a
 * cassette) + a static HTML server (standing in for the real target site).
 * Verifies: tool loads, params interpolate, execution completes exit 0,
 * and stdout contains structured extraction output.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFromCassette } from './helpers/vcr.js';
import { startStaticServer } from '../helpers/staticServer.js';

const CWD = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function runIbr(args, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', ['src/index.js', ...args], {
      env: { ...process.env, ...env },
      cwd: CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => resolve({ code, stdout, stderr }));
    proc.stdin.end();
  });
}

const BASE_ENV = {
  BROWSER_HEADLESS: 'true',
  BROWSER_SLOWMO: '0',
  BROWSER_TIMEOUT: '5000',
  CACHE_ENABLED: 'false',
  INSTRUCTION_EXECUTION_DELAY_MS: '0',
  INSTRUCTION_EXECUTION_JITTER_MS: '0',
  PAGE_LOADING_DELAY_MS: '0',
  LOG_LEVEL: 'error',
  OPENAI_API_KEY: 'test-key',
};

// ─── trend-search (T-0007) ───────────────────────────────────────────────────

describe('ibr tool trend-search (T-0007)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-trend-search', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'trend-search', '--param', 'topic=javascript'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Task execution completed/i);
  }, 30000);

  it('does not error on tool config (YAML parse, param resolution)', async () => {
    const result = await runIbr(
      ['tool', 'trend-search', '--param', 'topic=javascript', '--param', 'region=GB'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    const combined = result.stdout + result.stderr;
    expect(combined).not.toMatch(/Tool not found|Missing required param|CONFIG_ERROR/i);
  }, 30000);
});

// ─── github-search (T-0008) ──────────────────────────────────────────────────

describe('ibr tool github-search (T-0008)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-github-search', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'github-search', '--param', 'query=playwright'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Task execution completed/i);
  }, 30000);

  it('type param defaults to repositories without error', async () => {
    const result = await runIbr(
      ['tool', 'github-search', '--param', 'query=vitest'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    const combined = result.stdout + result.stderr;
    expect(combined).not.toMatch(/Missing required param|Tool not found/i);
  }, 30000);
});

// ─── github-trending (T-0009) ────────────────────────────────────────────────

describe('ibr tool github-trending (T-0009)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-github-trending', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 with no params (all optional)', async () => {
    const result = await runIbr(
      ['tool', 'github-trending'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
  }, 30000);

  it('exits 0 with language + period params', async () => {
    let ai2, web2;
    try {
      web2 = await startStaticServer();
      ai2 = await startFromCassette('tool-github-trending-lang', { SERVER_URL: web2.baseUrl });
      const result = await runIbr(
        ['tool', 'github-trending', '--param', 'language=go', '--param', 'period=weekly'],
        { ...BASE_ENV, OPENAI_BASE_URL: ai2.baseUrl },
      );
      expect(result.code).toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/Task execution completed/i);
    } finally {
      await ai2?.close();
      await web2?.close();
    }
  }, 30000);
});

// ─── github-starred (T-0010) ─────────────────────────────────────────────────

describe('ibr tool github-starred (T-0010)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-github-starred', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'github-starred', '--param', 'username=sindresorhus'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Task execution completed/i);
  }, 30000);

  it('username is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'github-starred'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/username|required param/i);
  }, 10000);
});

// ─── context7 (T-0005) ───────────────────────────────────────────────────────

describe('ibr tool context7 (T-0005)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-context7', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'context7', '--param', 'library=playwright', '--param', 'question=how to click an element'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('library is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'context7', '--param', 'question=how to click'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/library|required param/i);
  }, 10000);

  it('question is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'context7', '--param', 'library=playwright'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/question|required param/i);
  }, 10000);
});

// ─── ebay (T-0016) ───────────────────────────────────────────────────────────

describe('ibr tool ebay (T-0016)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-ebay', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'ebay', '--param', 'query=iphone 15 pro'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('query is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'ebay'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/query|required param/i);
  }, 10000);
});

// ─── npm (T-0017) ────────────────────────────────────────────────────────────

describe('ibr tool npm (T-0017)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-npm', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'npm', '--param', 'package=react'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('package is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'npm'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/package|required param/i);
  }, 10000);
});

// ─── reddit (T-0020) ─────────────────────────────────────────────────────────

describe('ibr tool reddit (T-0020)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-reddit', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'reddit', '--param', 'query=rust async'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('query is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'reddit'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/query|required param/i);
  }, 10000);
});

// ─── hackernews (T-0021) ─────────────────────────────────────────────────────

describe('ibr tool hackernews (T-0021)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-hackernews', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'hackernews', '--param', 'query=rust async'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('query is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'hackernews'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/query|required param/i);
  }, 10000);
});

// ─── yahoo-finance (T-0022) ───────────────────────────────────────────────────

describe('ibr tool yahoo-finance (T-0022)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-yahoo-finance', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'yahoo-finance', '--param', 'ticker=AAPL'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('ticker is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'yahoo-finance'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/ticker|required param/i);
  }, 10000);
});

// ─── dockerhub (T-0023) ──────────────────────────────────────────────────────

describe('ibr tool dockerhub (T-0023)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-dockerhub', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'dockerhub', '--param', 'image=nginx'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('image is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'dockerhub'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/image|required param/i);
  }, 10000);
});

// ─── wikipedia (T-0014) ───────────────────────────────────────────────────────

describe('ibr tool wikipedia (T-0014)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-wikipedia', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'wikipedia', '--param', 'topic=Playwright'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('topic is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'wikipedia'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/topic|required param/i);
  }, 10000);
});

// ─── amazon (T-0015) ─────────────────────────────────────────────────────────

describe('ibr tool amazon (T-0015)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-amazon', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'amazon', '--param', 'query=noise cancelling headphones'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('query is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'amazon'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/query|required param/i);
  }, 10000);
});

// ─── pypi (T-0018) ───────────────────────────────────────────────────────────

describe('ibr tool pypi (T-0018)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-pypi', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'pypi', '--param', 'package=requests'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('package is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'pypi'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/package|required param/i);
  }, 10000);
});

// ─── producthunt (T-0019) ────────────────────────────────────────────────────

describe('ibr tool producthunt (T-0019)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-producthunt', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'producthunt', '--param', 'query=notion'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('query is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'producthunt'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/query|required param/i);
  }, 10000);
});

// ─── arxiv (T-0012) ───────────────────────────────────────────────────────────

describe('ibr tool arxiv (T-0012)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-arxiv', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'arxiv', '--param', 'query=attention transformer'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('query is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'arxiv'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/query|required param/i);
  }, 10000);
});

// ─── web-archive (T-0013) ─────────────────────────────────────────────────────

describe('ibr tool web-archive (T-0013)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-web-archive', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'web-archive', '--param', 'url=https://example.com'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('url is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'web-archive'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/url|required param/i);
  }, 10000);
});

// ─── web-search (story 058) ───────────────────────────────────────────────────

describe('ibr tool web-search (story 058)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-web-search', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'web-search', '--param', 'query=playwright testing'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('query is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'web-search'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/query|required param/i);
  }, 10000);
});

// ─── web-fetch (story 059) ────────────────────────────────────────────────────

describe('ibr tool web-fetch (story 059)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-web-fetch', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'web-fetch', '--param', 'url=https://example.com'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('url is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'web-fetch'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/url|required param/i);
  }, 10000);
});
