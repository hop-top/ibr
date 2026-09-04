/**
 * Unit tests for --mode auto escalation to visual before healing (SPEC
 * vision-mode Unit 3, auto path / plan task "Operations: auto-escalation
 * ladder (aria->dom->visual, capped)").
 *
 * At both text-failure points in #actionInstruction — the find reported a
 * genuine miss (outcome "not_found"; tests h–n) or the try/catch around
 * performAction() that otherwise reaches healingService.attemptHeal (tests
 * a–g) — when this.mode === 'auto' and the text find/act has failed for this
 * instruction, escalate to a visual attempt (BEFORE calling attemptHeal on
 * the act-failure path). Reuses the explicit --mode visual resolve path
 * (VisualRepresenter.represent() + the visual find provider call). Capped
 * per run by VISUAL_MAX_ESCALATIONS (default 3, read once at construction).
 * Explicit --mode visual is unaffected by the cap (separate, already-tested
 * path in Operations.visual-mode.test.js).
 *
 * Mocks VisualRepresenter, generateAIResponse, HealingService.attemptHeal,
 * and spies on the NdjsonStreamer singleton — no real browser, no real AI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/ai/provider.js');
vi.mock('../../src/cache/CacheManager.js');
vi.mock('../../src/utils/logger.js');
vi.mock('../../src/services/AnnotationService.js');
vi.mock('../../src/VisualRepresenter.js');
vi.mock('../../src/services/WsmAdapter.js', () => ({
    wsmAdapter: {
        recordArtifact: vi.fn().mockResolvedValue(undefined),
        recordToolCall: vi.fn().mockResolvedValue(undefined),
        recordDiagnostics: vi.fn().mockResolvedValue(undefined),
        queryDomainFailureCount: vi.fn().mockResolvedValue(0),
    },
}));
// resolveElement/selectMode are mocked so text find/act stays on a
// deterministic 'aria' path and returns a controllable descriptor.
vi.mock('../../src/utils/ariaSimplifier.js', () => ({
    getSnapshot: vi.fn().mockResolvedValue('- button "Submit"'),
    assessQuality: vi.fn().mockReturnValue({ score: 1, isUsable: true }),
    selectMode: vi.fn().mockReturnValue({ mode: 'aria', reason: 'test' }),
    resolveElement: vi.fn(),
    SIZE_THRESHOLD: 200000,
    SPARSITY_THRESHOLD: 0.05,
}));

import { generateAIResponse } from '../../src/ai/provider.js';
import { CacheManager } from '../../src/cache/CacheManager.js';
import { VisualRepresenter } from '../../src/VisualRepresenter.js';
import { resolveElement } from '../../src/utils/ariaSimplifier.js';
import { streamer } from '../../src/observability/NdjsonStreamer.js';
import { HealingService } from '../../src/services/HealingService.js';
import { Operations } from '../../src/Operations.js';

// ── stubs ────────────────────────────────────────────────────────────────

CacheManager.mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    generateKey: vi.fn().mockReturnValue('k'),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
}));

let mockRepresent;
VisualRepresenter.mockImplementation(() => ({
    represent: mockRepresent,
}));

function makeLocator({ clickFails = false } = {}) {
    return {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: clickFails
            ? vi.fn().mockRejectedValue(new Error('element is not visible'))
            : vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        type: vi.fn().mockResolvedValue(undefined),
        press: vi.fn().mockResolvedValue(undefined),
        count: vi.fn().mockResolvedValue(1),
        isVisible: vi.fn().mockResolvedValue(false),
        isEnabled: vi.fn().mockResolvedValue(false),
        ariaSnapshot: vi.fn().mockResolvedValue('- button "Submit"'),
    };
}

function makePage(textLocator) {
    return {
        content: vi.fn().mockResolvedValue('<html><body></body></html>'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(0),
        url: vi.fn().mockReturnValue('https://example.com'),
        locator: vi.fn().mockReturnValue(textLocator),
        getByRole: vi.fn().mockReturnValue(textLocator),
        getByLabel: vi.fn().mockReturnValue(textLocator),
        getByText: vi.fn().mockReturnValue(textLocator),
        getByPlaceholder: vi.fn().mockReturnValue(textLocator),
        mouse: { click: vi.fn().mockResolvedValue(undefined) },
        keyboard: {
            type: vi.fn().mockResolvedValue(undefined),
            press: vi.fn().mockResolvedValue(undefined),
        },
        on: vi.fn(),
        off: vi.fn(),
    };
}

function makeCtx(page) {
    return {
        aiProvider: { modelInstance: {}, provider: 'openai', model: 'gpt-4' },
        page,
    };
}

function aiResp(content) {
    return { content, usage: { promptTokens: 5, completionTokens: 3 } };
}

const IMAGE_BUFFER = Buffer.from('fake-png-bytes');

const TASK = {
    url: 'https://example.com',
    instructions: [],
};

// Text-mode action response: a descriptor whose click will fail (the
// "text find/act has failed" trigger for auto-escalation).
const TEXT_ACTION_RESP = JSON.stringify({
    elements: [{ role: 'button', name: 'Submit' }],
    type: 'click',
});

function elementMarkMap(label, locator) {
    const m = new Map();
    m.set(label, { element: locator, bbox: { x: 10, y: 20, width: 30, height: 40 } });
    return m;
}

function gridMarkMap(cellId = 'r0c0', bbox = { x: 100, y: 200, width: 50, height: 60 }) {
    const m = new Map();
    m.set(cellId, { bbox, cellId });
    return m;
}

describe('Operations auto-mode visual escalation', () => {
    let page;
    let textLocator;
    let visualLocator;
    let attemptHealSpy;

    beforeEach(() => {
        vi.clearAllMocks();
        // clearAllMocks() clears call history but does NOT drain queued
        // mockResolvedValueOnce() implementations from a prior test — reset
        // this mock explicitly so each test's queue starts empty.
        generateAIResponse.mockReset();
        delete process.env.VISUAL_MAX_ESCALATIONS;
        textLocator = makeLocator({ clickFails: true });
        visualLocator = makeLocator({ clickFails: false });
        page = makePage(textLocator);
        resolveElement.mockReturnValue(textLocator);
        mockRepresent = vi.fn().mockResolvedValue({
            image: IMAGE_BUFFER,
            mime: 'image/png',
            markMap: elementMarkMap('@e2', visualLocator),
            strategy: 'elements',
        });
        attemptHealSpy = vi
            .spyOn(HealingService.prototype, 'attemptHeal')
            .mockResolvedValue(null);
    });

    afterEach(() => {
        attemptHealSpy.mockRestore();
        delete process.env.VISUAL_MAX_ESCALATIONS;
    });

    // (a) text find fails -> visual attempt made BEFORE attemptHeal; visual
    // resolves -> attemptHeal NOT called, instruction succeeds.
    it('(a) escalates to visual before healing when text action fails, and skips healing on visual success', async () => {
        generateAIResponse
            .mockResolvedValueOnce(aiResp(TEXT_ACTION_RESP)) // text action-instruction call
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }]))); // visual find call

        const ops = new Operations(makeCtx(page), { mode: 'auto' });

        await expect(
            ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'submit' }] })
        ).resolves.toBeUndefined();

        expect(mockRepresent).toHaveBeenCalled();
        expect(visualLocator.click).toHaveBeenCalled();
        expect(attemptHealSpy).not.toHaveBeenCalled();
    });

    // (b) text find succeeds -> no visual escalation at all.
    it('(b) does not escalate to visual when the text action succeeds', async () => {
        const workingLocator = makeLocator({ clickFails: false });
        resolveElement.mockReturnValue(workingLocator);
        generateAIResponse.mockResolvedValueOnce(aiResp(TEXT_ACTION_RESP));

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'submit' }] });

        expect(workingLocator.click).toHaveBeenCalled();
        // VisualRepresenter is constructed unconditionally by Operations'
        // constructor, but its represent() must never be invoked
        // when the text action succeeds — that is the actual "no escalation"
        // signal for the auto path.
        expect(mockRepresent).not.toHaveBeenCalled();
        expect(attemptHealSpy).not.toHaveBeenCalled();
    });

    // (c) cap: VISUAL_MAX_ESCALATIONS=1 -> the 2nd failing instruction does
    // NOT escalate, and a cap-hit note is emitted.
    it('(c) stops escalating once VISUAL_MAX_ESCALATIONS is reached and logs a cap-hit note', async () => {
        process.env.VISUAL_MAX_ESCALATIONS = '1';

        // Instruction 1: text action fails, visual escalation resolves
        // (consumes the single allowed escalation, instruction succeeds —
        // task continues to instruction 2 instead of aborting).
        // Instruction 2: text action fails again; the cap is already spent,
        // so escalation is denied outright (no represent() call) and the
        // run falls through to healing, which is mocked to fail — the task
        // rejects, but only AFTER the cap-hit note fires.
        generateAIResponse
            .mockResolvedValueOnce(aiResp(TEXT_ACTION_RESP)) // instr 1 text action (fails)
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }]))) // instr 1 visual find (resolves)
            .mockResolvedValueOnce(aiResp(TEXT_ACTION_RESP)); // instr 2 text action (fails)

        const capNoteSpy = vi.spyOn(streamer, 'visualEscalationCapped');

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await expect(
            ops.executeTask({
                ...TASK,
                instructions: [
                    { name: 'click', prompt: 'submit' },
                    { name: 'click', prompt: 'submit again' },
                ],
            })
        ).rejects.toThrow();

        // Escalation attempted exactly once (instr 1) — represent() called once,
        // NOT twice, because instr 2's attempt is blocked by the cap.
        expect(mockRepresent).toHaveBeenCalledTimes(1);
        expect(visualLocator.click).toHaveBeenCalledTimes(1);
        // Cap-hit note emitted for the 2nd (denied) escalation attempt.
        expect(capNoteSpy).toHaveBeenCalledWith(
            expect.objectContaining({ cap: 1 })
        );
        // Healing runs only for instruction 2 — instruction 1 was resolved
        // by the visual escalation and never reached attemptHeal.
        expect(attemptHealSpy).toHaveBeenCalledTimes(1);

        capNoteSpy.mockRestore();
    });

    // (d) explicit --mode visual ignores the cap entirely.
    it('(d) explicit --mode visual is unaffected by VISUAL_MAX_ESCALATIONS', async () => {
        process.env.VISUAL_MAX_ESCALATIONS = '1';

        generateAIResponse
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }])))
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }])))
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }])));

        const ops = new Operations(makeCtx(page), { mode: 'visual' });
        await ops.executeTask({
            ...TASK,
            instructions: [
                { name: 'click', prompt: 'submit' },
                { name: 'click', prompt: 'submit again' },
                { name: 'click', prompt: 'submit a third time' },
            ],
        });

        // Three explicit visual calls, all resolved via VisualRepresenter,
        // none blocked by the cap of 1.
        expect(mockRepresent).toHaveBeenCalledTimes(3);
        expect(visualLocator.click).toHaveBeenCalledTimes(3);
        expect(attemptHealSpy).not.toHaveBeenCalled();
    });

    // (f) SPEC Unit 4 wiring: escalation resolves a mark but the subsequent
    // action itself then fails -> falls through to healing WITH the cached
    // visual representation (image/mime/markMap) as the 5th attemptHeal arg.
    it('(f) passes the cached visual representation into attemptHeal when escalation resolved a mark but the action failed', async () => {
        const failingVisualLocator = makeLocator({ clickFails: true });
        mockRepresent = vi.fn().mockResolvedValue({
            image: IMAGE_BUFFER,
            mime: 'image/png',
            markMap: elementMarkMap('@e2', failingVisualLocator),
            strategy: 'elements',
        });
        VisualRepresenter.mockImplementation(() => ({ represent: mockRepresent }));

        generateAIResponse
            .mockResolvedValueOnce(aiResp(TEXT_ACTION_RESP)) // text action fails
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }]))); // visual find resolves a mark

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await expect(
            ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'submit' }] })
        ).rejects.toThrow();

        expect(failingVisualLocator.click).toHaveBeenCalled();
        expect(attemptHealSpy).toHaveBeenCalledTimes(1);
        const [, , , , visualContext] = attemptHealSpy.mock.calls[0];
        expect(visualContext).toEqual(
            expect.objectContaining({ image: IMAGE_BUFFER, mime: 'image/png' })
        );
        expect(visualContext.markMap).toBeInstanceOf(Map);
    });

    // (g) pure-text-failure path (no visual attempt ran for this instruction
    // because the cap was already spent by a prior instruction) -> attemptHeal
    // called with NO 5th arg (the existing 4-arg call, unchanged). Mirrors
    // test (c)'s cap scenario but asserts the attemptHeal call shape.
    it('(g) calls attemptHeal with no visual context (4-arg call) when no visual attempt ran for the instruction', async () => {
        process.env.VISUAL_MAX_ESCALATIONS = '1';

        generateAIResponse
            .mockResolvedValueOnce(aiResp(TEXT_ACTION_RESP)) // instr 1 text action (fails)
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }]))) // instr 1 visual find (resolves, spends the cap)
            .mockResolvedValueOnce(aiResp(TEXT_ACTION_RESP)); // instr 2 text action (fails); cap already spent

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await expect(
            ops.executeTask({
                ...TASK,
                instructions: [
                    { name: 'click', prompt: 'submit' },
                    { name: 'click', prompt: 'submit again' },
                ],
            })
        ).rejects.toThrow();

        // Escalation attempted only for instr 1 (consumes the cap); instr 2's
        // healing call is the pure-text-failure path with no visual context.
        expect(mockRepresent).toHaveBeenCalledTimes(1);
        expect(attemptHealSpy).toHaveBeenCalledTimes(1);
        expect(attemptHealSpy.mock.calls[0]).toHaveLength(4);
    });

    // (h) the failed text action's value is reused by the visual retry: the
    // escalation must perform the SAME action with the SAME value the text
    // attempt intended, not fill/type/press with undefined.
    it('(h) reuses the failed text action value when the visual retry fills', async () => {
        const failingFillLocator = makeLocator();
        failingFillLocator.fill = vi.fn().mockRejectedValue(new Error('element is not visible'));
        resolveElement.mockReturnValue(failingFillLocator);

        generateAIResponse
            .mockResolvedValueOnce(aiResp(JSON.stringify({
                elements: [{ role: 'textbox', name: 'Email' }],
                type: 'fill',
                value: 'user@example.com',
            }))) // text action (fill fails)
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }]))); // visual find, no value

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await ops.executeTask({
            ...TASK,
            instructions: [{ name: 'fill', prompt: "type 'user@example.com' in the email box" }],
        });

        expect(failingFillLocator.fill).toHaveBeenCalledWith('user@example.com');
        expect(visualLocator.fill).toHaveBeenCalledWith('user@example.com');
        expect(attemptHealSpy).not.toHaveBeenCalled();
    });

    it('(h) reuses the failed text action value when the visual retry types', async () => {
        const failingTypeLocator = makeLocator();
        failingTypeLocator.type = vi.fn().mockRejectedValue(new Error('element is not visible'));
        resolveElement.mockReturnValue(failingTypeLocator);

        generateAIResponse
            .mockResolvedValueOnce(aiResp(JSON.stringify({
                elements: [{ role: 'textbox', name: 'Search' }],
                type: 'type',
                value: 'hello world',
            })))
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }])));

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await ops.executeTask({
            ...TASK,
            instructions: [{ name: 'type', prompt: "type 'hello world' into the search field" }],
        });

        expect(visualLocator.type).toHaveBeenCalledWith('hello world');
    });

    it('(h) reuses the failed text action key when the visual retry presses', async () => {
        const failingPressLocator = makeLocator();
        failingPressLocator.press = vi.fn().mockRejectedValue(new Error('element is not visible'));
        resolveElement.mockReturnValue(failingPressLocator);

        generateAIResponse
            .mockResolvedValueOnce(aiResp(JSON.stringify({
                elements: [{ role: 'textbox', name: 'Search' }],
                type: 'press',
                value: 'Enter',
            })))
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }])));

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await ops.executeTask({
            ...TASK,
            instructions: [{ name: 'press', prompt: 'press Enter in the search field' }],
        });

        expect(visualLocator.press).toHaveBeenCalledWith('Enter');
    });

    // (e) a 'visual.escalation' event is emitted on escalation.
    it('(e) emits a visual.escalation NDJSON event when escalating', async () => {
        generateAIResponse
            .mockResolvedValueOnce(aiResp(TEXT_ACTION_RESP))
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }])));

        const escalationSpy = vi.spyOn(streamer, 'visualEscalation');

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'submit' }] });

        expect(escalationSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                instructionIndex: expect.any(Number),
                reason: expect.any(String),
            })
        );

        escalationSpy.mockRestore();
    });

    // ── find-miss path: the text find resolves NO elements ─────────────────
    // An empty element set is a FIND failure, not an ACT failure — it never
    // reaches the performAction catch. But `{"elements": []}` on its own is
    // AMBIGUOUS: it is also the shape of a legitimate no-op (a page-level
    // scroll, an optional click). The reply's `outcome` field disambiguates:
    // only "not_found" is a genuine miss worth a visual attempt. Everything
    // else — "no_element_needed", an unknown value, or NO outcome field at
    // all (every pre-existing cassette) — stays the historical silent skip.

    const MISS_RESP = JSON.stringify({ elements: [], type: 'click', outcome: 'not_found' });
    const NOOP_SCROLL_RESP = JSON.stringify({ elements: [], type: 'scroll', outcome: 'no_element_needed' });
    const LEGACY_EMPTY_RESP = JSON.stringify({ elements: [], type: 'scroll' });

    // (h) find-miss under auto -> visual attempt runs, resolves, and the
    // instruction completes via the visual click; healing never runs.
    it('(h) escalates to visual when the text find reports outcome not_found under --mode auto', async () => {
        generateAIResponse
            .mockResolvedValueOnce(aiResp(MISS_RESP)) // text find: genuine miss
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }]))); // visual find resolves

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await expect(
            ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'submit' }] })
        ).resolves.toBeUndefined();

        expect(mockRepresent).toHaveBeenCalledTimes(1);
        expect(visualLocator.click).toHaveBeenCalledTimes(1);
        expect(textLocator.click).not.toHaveBeenCalled();
        expect(attemptHealSpy).not.toHaveBeenCalled();
    });

    // (i) inverse guard of (h): a find-miss outside auto is the historical
    // silent skip — no visual attempt, no healing, no throw.
    it('(i) does not escalate on a not_found text find when mode is not auto', async () => {
        generateAIResponse.mockResolvedValueOnce(aiResp(MISS_RESP));

        const ops = new Operations(makeCtx(page), { mode: 'aria' });
        await expect(
            ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'submit' }] })
        ).resolves.toBeUndefined();

        expect(mockRepresent).not.toHaveBeenCalled();
        expect(visualLocator.click).not.toHaveBeenCalled();
        expect(attemptHealSpy).not.toHaveBeenCalled();
    });

    // (j) find-miss under auto where the visual attempt resolves no mark ->
    // back to the historical skip: not fatal, and healing is not invoked
    // (there is no locator or action error for it to work with).
    it('(j) falls back to the skip (no throw, no heal) when the find-miss visual attempt resolves nothing', async () => {
        generateAIResponse
            .mockResolvedValueOnce(aiResp(MISS_RESP))
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@nope' }]))); // label absent from markMap

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await expect(
            ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'submit' }] })
        ).resolves.toBeUndefined();

        expect(mockRepresent).toHaveBeenCalledTimes(1);
        expect(visualLocator.click).not.toHaveBeenCalled();
        expect(attemptHealSpy).not.toHaveBeenCalled();
    });

    // (k) find-miss escalations spend VISUAL_MAX_ESCALATIONS exactly like
    // act-failure ones; once the cap is spent, a find-miss is the plain skip
    // again (cap-hit note emitted, task still completes).
    it('(k) find-miss escalations are capped by VISUAL_MAX_ESCALATIONS', async () => {
        process.env.VISUAL_MAX_ESCALATIONS = '1';
        generateAIResponse
            .mockResolvedValueOnce(aiResp(MISS_RESP)) // instr 1 text find: miss
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }]))) // instr 1 visual find (spends the cap)
            .mockResolvedValueOnce(aiResp(MISS_RESP)); // instr 2 text find: miss, cap spent
        const capNoteSpy = vi.spyOn(streamer, 'visualEscalationCapped');

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await expect(
            ops.executeTask({
                ...TASK,
                instructions: [
                    { name: 'click', prompt: 'submit' },
                    { name: 'click', prompt: 'submit again' },
                ],
            })
        ).resolves.toBeUndefined();

        expect(mockRepresent).toHaveBeenCalledTimes(1);
        expect(visualLocator.click).toHaveBeenCalledTimes(1);
        expect(capNoteSpy).toHaveBeenCalledWith(expect.objectContaining({ cap: 1 }));
        expect(attemptHealSpy).not.toHaveBeenCalled();

        capNoteSpy.mockRestore();
    });

    // (l) a find-miss escalation emits the SAME visual.escalation event the
    // act-failure path does.
    it('(l) emits a visual.escalation NDJSON event on a find-miss escalation', async () => {
        generateAIResponse
            .mockResolvedValueOnce(aiResp(MISS_RESP))
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }])));
        const escalationSpy = vi.spyOn(streamer, 'visualEscalation');

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'submit' }] });

        expect(escalationSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                instructionIndex: expect.any(Number),
                reason: expect.any(String),
            })
        );

        escalationSpy.mockRestore();
    });

    // ── no-op regression guards: an empty `elements` array that is NOT a miss
    // must never trigger a visual attempt. This is what a blanket
    // "escalate on every empty find" would break: an extra screenshot +
    // vision call on every legitimate no-op step.

    // (m) explicit no_element_needed (page-level scroll) -> no escalation.
    it('(m) does not escalate on a page-level scroll reply (outcome no_element_needed)', async () => {
        generateAIResponse.mockResolvedValueOnce(aiResp(NOOP_SCROLL_RESP));

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await expect(
            ops.executeTask({ ...TASK, instructions: [{ name: 'scroll', prompt: 'scroll down' }] })
        ).resolves.toBeUndefined();

        expect(mockRepresent).not.toHaveBeenCalled();
        expect(visualLocator.click).not.toHaveBeenCalled();
        expect(attemptHealSpy).not.toHaveBeenCalled();
    });

    // (n) backward compatibility: a reply with NO outcome field at all — the
    // shape every pre-existing cassette and unit fixture emits — keeps
    // behaving exactly as before: a silent skip, never an escalation.
    it('(n) does not escalate on an empty-elements reply carrying no outcome field', async () => {
        generateAIResponse.mockResolvedValueOnce(aiResp(LEGACY_EMPTY_RESP));

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await expect(
            ops.executeTask({ ...TASK, instructions: [{ name: 'scroll', prompt: 'scroll down' }] })
        ).resolves.toBeUndefined();

        expect(mockRepresent).not.toHaveBeenCalled();
        expect(visualLocator.click).not.toHaveBeenCalled();
        expect(attemptHealSpy).not.toHaveBeenCalled();
    });

    // ── scroll never performs some OTHER action on the visual path ────────
    // `no_element_needed` already keeps a page-level scroll off this path
    // (test m). But a model that mislabels a scroll as `not_found` still
    // drags it here — and a scroll has no coherent "act on this mark"
    // meaning. It must resolve to nothing, never to a click.

    const SCROLL_MISS_RESP = JSON.stringify({ elements: [], type: 'scroll', outcome: 'not_found' });

    // (o) THE regression guard for the silent-click defect: a scroll that
    // escalates must not click the resolved element mark.
    it('(o) a scroll escalation never clicks the resolved element mark', async () => {
        generateAIResponse
            .mockResolvedValueOnce(aiResp(SCROLL_MISS_RESP))
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }])));

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await expect(
            ops.executeTask({ ...TASK, instructions: [{ name: 'scroll', prompt: 'scroll to the footer' }] })
        ).resolves.toBeUndefined();

        expect(visualLocator.click).not.toHaveBeenCalled();
        expect(visualLocator.fill).not.toHaveBeenCalled();
        expect(visualLocator.press).not.toHaveBeenCalled();
        expect(page.mouse.click).not.toHaveBeenCalled();
    });

    // (p) same guard on the grid strategy: no mouse click at the cell centre.
    it('(p) a scroll escalation never clicks a resolved grid cell centre', async () => {
        mockRepresent = vi.fn().mockResolvedValue({
            image: IMAGE_BUFFER,
            mime: 'image/png',
            markMap: gridMarkMap('r0c0', { x: 100, y: 200, width: 50, height: 60 }),
            strategy: 'grid',
        });
        VisualRepresenter.mockImplementation(() => ({ represent: mockRepresent }));

        generateAIResponse
            .mockResolvedValueOnce(aiResp(SCROLL_MISS_RESP))
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: 'r0c0' }])));

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await expect(
            ops.executeTask({ ...TASK, instructions: [{ name: 'scroll', prompt: 'scroll to the footer' }] })
        ).resolves.toBeUndefined();

        expect(page.mouse.click).not.toHaveBeenCalled();
        expect(page.keyboard.type).not.toHaveBeenCalled();
    });

    // (q) grid strategy on the escalation path threads the value the same
    // way the explicit path does — click-to-focus then keyboard.type, never
    // a bare click that drops the text.
    it('(q) a fill escalation onto a grid cell focuses the cell then types the value', async () => {
        mockRepresent = vi.fn().mockResolvedValue({
            image: IMAGE_BUFFER,
            mime: 'image/png',
            markMap: gridMarkMap('r0c0', { x: 100, y: 200, width: 50, height: 60 }),
            strategy: 'grid',
        });
        VisualRepresenter.mockImplementation(() => ({ represent: mockRepresent }));

        const failingFillLocator = makeLocator();
        failingFillLocator.fill = vi.fn().mockRejectedValue(new Error('element is not visible'));
        resolveElement.mockReturnValue(failingFillLocator);

        generateAIResponse
            .mockResolvedValueOnce(aiResp(JSON.stringify({
                elements: [{ role: 'textbox', name: 'Email' }],
                type: 'fill',
                value: 'user@example.com',
            })))
            .mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: 'r0c0' }])));

        const ops = new Operations(makeCtx(page), { mode: 'auto' });
        await ops.executeTask({
            ...TASK,
            instructions: [{ name: 'fill', prompt: "type 'user@example.com' in the email box" }],
        });

        expect(page.mouse.click).toHaveBeenCalledWith(125, 230);
        expect(page.keyboard.type).toHaveBeenCalledWith('user@example.com');
        expect(attemptHealSpy).not.toHaveBeenCalled();
    });
});
