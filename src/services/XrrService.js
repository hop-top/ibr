import { FileSession, FileCassette } from '@hop-top/xrr';
import { IbrXrrAdapter } from './IbrXrrAdapter.js';
import path from 'path';
import os from 'os';

/**
 * XrrService — manages recording sessions.
 */
export class XrrService {
  constructor(opts = {}) {
    const mode = opts.mode || process.env.XRR_MODE || 'passthrough';
    const cassetteDir = opts.cassetteDir || process.env.XRR_CASSETTE_DIR || path.join(os.homedir(), '.ibr', 'cassettes');
    
    this.cassette = new FileCassette(cassetteDir);
    this.session = new FileSession(mode, this.cassette);
    this.adapter = new IbrXrrAdapter();
  }

  /**
   * Record or replay an AI call.
   */
  async recordAiCall(messages, options, do_) {
    return this.session.record(this.adapter, { messages, options }, do_);
  }
}

export const xrrService = new XrrService();
