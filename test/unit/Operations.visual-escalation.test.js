/**
 * Unit tests for --mode auto escalation to visual before healing (SPEC
 * vision-mode Unit 3, auto path / plan task "Operations: auto-escalation
 * ladder (aria->dom->visual, capped)").
 *
 * At the existing action-failure point in #actionInstruction (the
 * try/catch around performAction() that otherwise reaches
 * healingService.attemptHeal), when this.mode === 'auto' and the text
 * find/act has failed for this instruction, escalate to a visual attempt
 * BEFORE calling attemptHeal. Reuses the explicit --mode visual resolve path
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
});
