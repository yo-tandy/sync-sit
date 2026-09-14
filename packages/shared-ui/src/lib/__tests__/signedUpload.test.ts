import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { putToSignedUrl } from '../signedUpload.js';

const SIGNED = { url: 'https://storage.googleapis.com/signed?sig=abc', path: 'verification-documents/fam1/identity-uuid.pdf' };
const FILE = new File([new Uint8Array([1, 2, 3])], 'id.pdf', { type: 'application/pdf' });

describe('putToSignedUrl', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('PUTs to the signed URL with the bound Content-Type AND x-goog-content-length-range headers', async () => {
    const path = await putToSignedUrl(SIGNED, FILE, 'application/pdf', 10 * 1024 * 1024);
    expect(path).toBe(SIGNED.path);
    expect(fetchMock).toHaveBeenCalledWith(SIGNED.url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
        'x-goog-content-length-range': '0,10485760',
      },
      body: FILE,
    });
  });

  it('tags a network-level fetch rejection with code: upload/network', async () => {
    const networkErr = new Error('offline');
    fetchMock.mockRejectedValueOnce(networkErr);
    await expect(putToSignedUrl(SIGNED, FILE, 'application/pdf', 10 * 1024 * 1024)).rejects.toMatchObject({
      code: 'upload/network',
      cause: networkErr,
    });
  });

  it('tags a non-2xx response with code: upload/network', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    await expect(putToSignedUrl(SIGNED, FILE, 'application/pdf', 10 * 1024 * 1024)).rejects.toMatchObject({
      code: 'upload/network',
    });
  });
});
