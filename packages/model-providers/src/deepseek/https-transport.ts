/**
 * The ONE approved network path of the Company's model providers (verifier `l1-provider-boundary`): HTTPS to the
 * fixed DeepSeek origin, nothing else. The origin is a constant (no configurable URL, no model-controlled URL, no
 * redirect following, TLS verification as the platform default); every request is re-checked against the
 * endpoint allowlist; the bearer is used for this request only and never logged, stored or returned; response
 * headers never leave this module; bodies are bounded; a failure names its phase only.
 */
import { DEEPSEEK_API_ORIGIN, DEEPSEEK_MAX_REQUEST_BYTES, DEEPSEEK_MAX_RESPONSE_BYTES, assertDeepSeekEndpoint } from './declaration.js';
import { DeepSeekTransportFailure, type DeepSeekRequest, type DeepSeekResponse, type DeepSeekTransport } from './transport.js';

/** Connection-phase failure codes: the request never left this host. */
const NOT_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN']);

function phaseOf(error: unknown): DeepSeekTransportFailure {
  const e = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return new DeepSeekTransportFailure('TIMEOUT');
  const code = typeof e?.cause?.code === 'string' ? e.cause.code : typeof e?.code === 'string' ? e.code : '';
  return new DeepSeekTransportFailure(NOT_SENT.has(code) ? 'BEFORE_SEND' : 'AFTER_SEND');
}

export class DeepSeekHttpsTransport implements DeepSeekTransport {
  async send(request: DeepSeekRequest, signal: AbortSignal): Promise<DeepSeekResponse> {
    assertDeepSeekEndpoint(request.method, request.path);
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);
    if (body !== undefined && Buffer.byteLength(body, 'utf8') > DEEPSEEK_MAX_REQUEST_BYTES) throw new DeepSeekTransportFailure('BEFORE_SEND');
    let res: Response;
    try {
      res = await fetch(`${DEEPSEEK_API_ORIGIN}${request.path}`, {
        method: request.method,
        redirect: 'error',
        signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'qandeel-company-model-provider',
          Authorization: `Bearer ${request.bearer}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body } : {}),
      });
    } catch (error) {
      throw phaseOf(error);
    }
    let text: string;
    try {
      text = await res.text();
    } catch (error) {
      throw phaseOf(error);
    }
    if (Buffer.byteLength(text, 'utf8') > DEEPSEEK_MAX_RESPONSE_BYTES) return { status: res.status, body: null, oversize: true, malformed: false };
    if (text.length === 0) return { status: res.status, body: null, oversize: false, malformed: false };
    try {
      return { status: res.status, body: JSON.parse(text) as unknown, oversize: false, malformed: false };
    } catch {
      return { status: res.status, body: null, oversize: false, malformed: true };
    }
  }
}
