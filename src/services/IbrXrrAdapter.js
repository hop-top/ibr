import crypto from 'crypto';

/**
 * IbrXrrAdapter — adapter for recording AI responses.
 */
export class IbrXrrAdapter {
  constructor() {
    this.id = 'ibr-ai-response';
  }

  /**
   * Fingerprint based on the prompt content and current page context.
   */
  async fingerprint(req) {
    const json = JSON.stringify({
      messages: req.messages,
      options: req.options
    });
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  serializeReq(req) {
    return req;
  }

  serializeResp(resp) {
    return resp;
  }

  deserializeReq(data) {
    return data;
  }

  deserializeResp(data) {
    return data;
  }
}
