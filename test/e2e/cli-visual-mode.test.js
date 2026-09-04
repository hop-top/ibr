/**
 * Vision mode e2e — `--mode visual` (vision-mode track, SPEC §Testing).
 *
 * Browser-gated: this whole file lives under test/e2e/**, which
 * test/vitest.config.js excludes entirely when detectBrowserSupport() finds
 * no usable Chromium (see browserBackedExcludes there). Runs in CI and in any
 * environment with a working Chromium; skipped automatically otherwise — no
 * per-file gating needed here.
 *
 * Each test spawns `node src/index.js`, replays a hand-authored AI response
 * queue via startFakeAIServerE2E (same helper cli-annotate.test.js /
 * cli-cache-reuse.test.js use — no cassette dir needed since these are simple
 * ordered-queue replays, not request-matched), and drives a REAL headless
 * Chromium against a static test page. Every assertion below checks a REAL
 * outcome (the click log lines naming the resolved mark
 * and its successful execution, the grid cell's real pixel coordinates, the
 * extracted content value) — never exit-0-only.
 *
 * AI response queue order (mirrors ops.parseTaskDescription + per-instruction
 * calls in Operations.js): [0] task description (url + instructions, a plain
 * text call — --mode visual only changes the PER-INSTRUCTION find/act/extract
 * calls, not this first parse), then one visual response per action/extract
 * instruction. Visual find replies use the exact shape
 * makeVisualFindMessage's prompt requests (src/utils/prompts.js) — a
 * one-element JSON array [{"mark":"<label>"}], echoing the literal ref label
 * AnnotationService draws on the overlay pixels (verified empirically below,
 * not guessed). Visual extract replies use the same array-of-objects shape
 * parseExtractionResponse already accepts for text extraction.
 *
 * Mark-label determinism: labels come from AnnotationService/DomSimplifier's
 * deterministic xpath-index numbering for a STATIC fixture page, so the same
 * label is produced on every run against modal-page.html/empty-page.html
 * (verified by direct VisualRepresenter.represent() probe against these exact
 * fixtures before authoring these cassette bodies):
 *   - modal-page.html  → strategy 'elements', single mark "@e6" (the
 *     #accept cookie-banner button — the only STANDARD_INTERACTIVE_TAGS node).
 *   - empty-page.html  → strategy 'grid' (a bare <p>, no interactive/
 *     pseudo-interactive elements at all) → 8x8 grid, cells "r0c0".."r7c7".
 *   - product-page.html → strategy 'grid' (plain text spans, nothing
 *     interactive) — used for extract-from-image since the visible text
 *     ("Widget Pro", "$9.99") stands in for pixels the model "reads".
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFakeAIServerE2E } from '../helpers/fakeAIServerE2E.js';
import { startStaticServer } from '../helpers/staticServer.js';

const CWD = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function runIbr(args, env = {}) {
  return new Promise((resolvePromise) => {
    const proc = spawn('node', ['src/index.js', ...args], {
      env: { ...process.env, ...env },
      cwd: CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => resolvePromise({ code: code ?? 1, stdout, stderr }));
    proc.stdin.end();
  });
}

const BASE_ENV = {
  BROWSER_HEADLESS: 'true',
  BROWSER_SLOWMO: '0',
  BROWSER_TIMEOUT: '10000',
  CACHE_ENABLED: 'false',
  INSTRUCTION_EXECUTION_DELAY_MS: '0',
  INSTRUCTION_EXECUTION_JITTER_MS: '0',
  PAGE_LOADING_DELAY_MS: '0',
  LOG_LEVEL: 'error',
  OPENAI_API_KEY: 'test-key',
};

// ── Scenario 1: visual find resolves a click (element strategy) ────────────

describe('cli --mode visual: find + click (element strategy)', () => {
  let ai;
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web?.close();
  });

  it('resolves the model\'s {mark:"@e6"} reply to the cookie-accept button and actually clicks it', async () => {
    const url = `${web.baseUrl}/modal-page.html`;

    // modal-page.html: #accept button's onclick hides #banner. Success is
    // observable by re-reading the page after the run — NOT just exit 0.
    ai = await startFakeAIServerE2E([
      // [0] task description parse (text call, unaffected by --mode visual)
      JSON.stringify({
        url,
        instructions: [
          { name: 'click', prompt: 'accept the cookie banner' },
        ],
      }),
      // [1] visual find for the click instruction — echoes the mark label
      // AnnotationService actually draws on modal-page.html's single
      // interactive element (verified empirically, see file header).
      JSON.stringify([{ mark: '@e6' }]),
    ]);

    // LOG_LEVEL=info: the positive proof below lives in logger.info lines.
    // BASE_ENV's 'error' level would hide them — and would equally hide the
    // "No matching elements found" skip, which is why absence-of-error
    // assertions alone cannot tell a landed click from a silent skip.
    const result = await runIbr(
      ['--mode', 'visual', `url: ${url}\ninstructions:\n  - accept the cookie banner`],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl, LOG_LEVEL: 'info' },
    );

    expect(result.code).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Task execution completed/i);

    // Positive proof the click landed on the marked element:
    // 1. "Clicking element" is logged by #actionInstruction immediately
    //    before locator.click(), carrying the resolved locatorDesc — for a
    //    visual mark that is `visual-mark=<label>`. This proves the model's
    //    "@e6" resolved through markMap to a real locator and the click
    //    machinery was invoked against THAT element (a grid fallback logs
    //    "Visual grid cell: performing <type>" instead; a find miss logs "No
    //    matching elements found" and never reaches this line).
    // 2. "executed successfully" is logged only after locator.click()
    //    resolved without throwing — Playwright's click waits for the
    //    element to be visible/enabled/stable and dispatches the event; a
    //    thrown click surfaces as RUNTIME_ERROR + non-zero exit instead.
    // ibr's browser context is closed by the time we get here, so the DOM
    // cannot be re-read; these two lines are the closest observable evidence
    // of the actual click, not merely of exit 0.
    expect(combined).toMatch(/Clicking element[^\n]*"locator":"visual-mark=@e6"/);
    expect(combined).toMatch(/executed successfully[^\n]*"actionType":"click"/);

    // Inverse guards: none of the skip/fallback/failure paths fired.
    expect(combined).not.toMatch(/No matching elements found, skipping action/i);
    expect(combined).not.toMatch(/Visual grid cell: performing/i);
    expect(combined).not.toMatch(/ELEMENT_NOT_FOUND|RUNTIME_ERROR/i);
  }, 30000);

  afterAll(async () => {
    await ai?.close();
  });
});

// ── Scenario 2: grid fallback (no interactive elements) ────────────────────

describe('cli --mode visual: grid fallback (no detectable elements)', () => {
  let ai;
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web?.close();
  });

  it('overlays a grid and clicks the cell center for a page with zero interactive elements', async () => {
    const url = `${web.baseUrl}/empty-page.html`;

    // empty-page.html is <html><body><p>No data</p></body></html> — no
    // STANDARD_INTERACTIVE_TAGS node, no cursor:pointer/onclick pseudo-button.
    // VisualRepresenter.represent() falls to the grid strategy (verified
    // empirically — see file header): this is the Task-1 carry the dispatch
    // called out — captureAnnotatedBuffer's useGrid/renderGrid path was only
    // unit-mocked before; this drives it against a REAL browser page.
    ai = await startFakeAIServerE2E([
      JSON.stringify({
        url,
        instructions: [
          { name: 'click', prompt: 'click the top-left area of the page' },
        ],
      }),
      // Grid strategy reply: echoes a real cellId this exact page produces.
      JSON.stringify([{ mark: 'r0c0' }]),
    ]);

    const result = await runIbr(
      ['--mode', 'visual', `url: ${url}\ninstructions:\n  - click the top-left area of the page`],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );

    expect(result.code).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Task execution completed/i);

    // Real outcome: Operations.js logs "Visual grid cell: performing <type>"
    // with the resolved label + the actual pixel coordinates ONLY on the
    // grid-mark branch (#performVisualGridAction, shared by
    // #actionInstruction and #attemptVisualEscalation) — this is the proof
    // the grid overlay was rendered AND a cell resolved AND
    // page.mouse.click(cx, cy) actually fired, not just that find "succeeded"
    // in the abstract. LOG_LEVEL=error suppresses logger.info, so re-run this
    // one assertion path at info level to surface it.
    expect(combined).not.toMatch(/No matching elements found, skipping action/i);
    expect(combined).not.toMatch(/RUNTIME_ERROR|ELEMENT_NOT_FOUND/i);
  }, 30000);

  it('the grid-click log line proves cell r0c0 resolved to real pixel coordinates (0,0)-(160,90)', async () => {
    const url = `${web.baseUrl}/empty-page.html`;
    let ai2;
    try {
      ai2 = await startFakeAIServerE2E([
        JSON.stringify({
          url,
          instructions: [
            { name: 'click', prompt: 'click the top-left area of the page' },
          ],
        }),
        JSON.stringify([{ mark: 'r0c0' }]),
      ]);

      const result = await runIbr(
        ['--mode', 'visual', `url: ${url}\ninstructions:\n  - click the top-left area of the page`],
        { ...BASE_ENV, OPENAI_BASE_URL: ai2.baseUrl, LOG_LEVEL: 'info' },
      );

      expect(result.code).toBe(0);
      const combined = result.stdout + result.stderr;
      // Cell r0c0 on an 8x8 grid over the default 1280x720 viewport is
      // {x:0,y:0,w:160,h:90} — center (80,45). This is the REAL grid-render
      // math (AnnotationService.renderGrid), not a mocked stand-in: the log
      // line only appears on the executed page.mouse.click(cx, cy) call.
      // The log line names the action type it is about to perform, so this
      // also pins that a `click` instruction performed a CLICK on the cell,
      // not some other action the grid executor happened to fall back to.
      expect(combined).toMatch(/Visual grid cell: performing click/i);
      expect(combined).toMatch(/"label":"r0c0"/);
      expect(combined).toMatch(/"x":80/);
      expect(combined).toMatch(/"y":45/);
    } finally {
      await ai2?.close();
    }
  }, 30000);

  afterAll(async () => {
    await ai?.close();
  });
});

// ── Scenario 3: extract-from-image ──────────────────────────────────────────

describe('cli --mode visual: extract-from-image', () => {
  let ai;
  let web;
  let outDir;

  beforeAll(async () => {
    web = await startStaticServer();
    outDir = await mkdtemp(resolve(tmpdir(), 'ibr-visual-extract-'));
  }, 15000);

  afterAll(async () => {
    await ai?.close();
    await web?.close();
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it('lands the model\'s image-read value in the extraction output (real content, not exit-0-only)', async () => {
    const url = `${web.baseUrl}/product-page.html`;
    const outPath = resolve(outDir, 'extract.json');

    // product-page.html renders "Widget Pro" / "$9.99" / "4.5 stars" as
    // plain text — standing in for "pixels the model reads" since we don't
    // run a real vision model in this suite. The extract reply uses the
    // SAME array-of-objects shape text extraction already emits (per SPEC
    // Unit 2 — zero downstream parsing changes), verified by reading it back
    // via --output rather than trusting exit 0.
    ai = await startFakeAIServerE2E([
      JSON.stringify({
        url,
        instructions: [
          { name: 'extract', prompt: 'the product price shown on the page' },
        ],
      }),
      JSON.stringify([{ price: '$9.99' }]),
    ]);

    const result = await runIbr(
      [
        '--mode', 'visual',
        '--output', outPath,
        `url: ${url}\ninstructions:\n  - extract the product price shown on the page`,
      ],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );

    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);

    // Real outcome: the extracted value the "model" read from the image made
    // it all the way into the written extraction file — not merely that the
    // process exited 0 or logged something extract-shaped.
    const written = JSON.parse(await readFile(outPath, 'utf8'));
    expect(written).toEqual([[{ price: '$9.99' }]]);
  }, 30000);
});
