import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

export function filterResponseHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const result: OutgoingHttpHeaders = { ...headers };
  delete result['x-frame-options'];
  delete result['X-Frame-Options'];
  delete result['cross-origin-opener-policy'];
  delete result['Cross-Origin-Opener-Policy'];

  const csp = headers['content-security-policy'] || headers['Content-Security-Policy'];
  if (typeof csp === 'string') {
    delete result['Content-Security-Policy'];
    result['content-security-policy'] = csp
      .split(';')
      .map(part => part.trim())
      .filter(part => !part.startsWith('frame-ancestors'))
      .join('; ');
  } else if (Array.isArray(csp)) {
    delete result['Content-Security-Policy'];
    result['content-security-policy'] = csp
      .flatMap(singleCsp => singleCsp.split(';'))
      .map(part => part.trim())
      .filter(part => !part.startsWith('frame-ancestors'))
      .join('; ');
  }

  return result;
}

export const cleanHeaders = filterResponseHeaders;

export function shouldInjectScript(contentType?: string): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes('text/html');
}
