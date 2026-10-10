import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { fetchTrustedFile, isServableContentType, isTrustedStorageUrl, limitStream, UntrustedUrlError } from '@/lib/server/safe-fetch';

/**
 * File Proxy API Route
 *
 * Solves: Chrome blocks cross-site iframe embeds of Supabase signed URLs.
 * (sec-fetch-dest: iframe + sec-fetch-site: cross-site → blocked by browser)
 *
 * How it works:
 *   1. The frontend calls this route instead of embedding the Supabase URL directly.
 *   2. This server-side route fetches the file (no CORS restrictions server-side).
 *   3. Streams the bytes back to the browser from localhost:3000 → same-origin.
 *   4. The iframe src is now localhost:3000/api/file-proxy?... → no Chrome block.
 *
 * Two usage modes:
 *
 *   Mode A – pass a pre-fetched signed URL (most common, used by Viewer2D):
 *     GET /api/file-proxy?url=<encodeURIComponent(signedUrl)>
 *
 *   Mode B – let the proxy fetch the signed URL from backend (used by BalloonDiagramViewer):
 *     GET /api/file-proxy?itemId=<bomItemId>&fileType=2d|3d
 *     Requires Authorization header to be forwarded.
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1/api';

// Largest file the proxy will relay (bytes); CAD models are the big ones.
const MAX_PROXY_BYTES = Number(process.env.FILE_PROXY_MAX_BYTES ?? 200 * 1024 * 1024);

export async function GET(request: NextRequest) {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    try {
        const { searchParams } = new URL(request.url);
        const directUrl = searchParams.get('url');
        const itemId = searchParams.get('itemId');
        const fileType = (searchParams.get('fileType') ?? '2d') as '2d' | '3d';

        let fileUrl: string;

        // ── Mode A: caller already has the signed URL ─────────────────────────────
        if (directUrl) {
            const decoded = decodeURIComponent(directUrl);
            if (!isTrustedStorageUrl(decoded)) {
                return NextResponse.json(
                    { error: 'URL host is not in the trusted storage allowlist' },
                    { status: 400 },
                );
            }
            fileUrl = decoded;
        }
        // ── Mode B: fetch signed URL from NestJS backend ───────────────────────────
        else if (itemId) {
            if (fileType !== '2d' && fileType !== '3d') {
                return NextResponse.json(
                    { error: 'fileType must be "2d" or "3d"' },
                    { status: 400 },
                );
            }

            const authHeader = request.headers.get('Authorization') ?? '';
            const signedUrlRes = await fetch(
                `${BACKEND_URL}/bom-items/${itemId}/file-url/${fileType}`,
                {
                    headers: {
                        Authorization: authHeader,
                        'Content-Type': 'application/json',
                    },
                },
            );

            if (!signedUrlRes.ok) {
                const errorText = await signedUrlRes.text().catch(() => signedUrlRes.statusText);
                return NextResponse.json(
                    { error: `Backend returned ${signedUrlRes.status}`, details: errorText },
                    { status: signedUrlRes.status },
                );
            }

            const signedUrlData = await signedUrlRes.json();
            fileUrl =
                signedUrlData?.url ??
                signedUrlData?.downloadUrl ??
                signedUrlData?.fileUrl ??
                signedUrlData?.signedUrl ??
                signedUrlData?.data?.url;

            if (!fileUrl) {
                return NextResponse.json(
                    { error: 'Backend did not return a file URL' },
                    { status: 502 },
                );
            }
        } else {
            return NextResponse.json(
                { error: 'Provide either "url" or "itemId" query parameter' },
                { status: 400 },
            );
        }

        // ── Fetch the file bytes server-side (trusted host only, redirects re-checked) ──
        let fileRes: Response;
        try {
            fileRes = await fetchTrustedFile(fileUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Mithran-FileProxy/1.0)' },
            });
        } catch (e) {
            if (e instanceof UntrustedUrlError) {
                return NextResponse.json({ error: 'File URL is not on the trusted storage host' }, { status: 400 });
            }
            throw e;
        }

        if (!fileRes.ok) {
            return NextResponse.json(
                { error: `Storage returned ${fileRes.status}: ${fileRes.statusText}` },
                { status: fileRes.status },
            );
        }

        // ── Stream back to browser from localhost → same-origin ───────────────────
        const contentType = fileRes.headers.get('content-type');
        // Only documents, images and CAD models: never something a browser renders as a page.
        if (!isServableContentType(contentType)) {
            return NextResponse.json({ error: 'File type is not allowed through the proxy' }, { status: 415 });
        }
        const contentLength = fileRes.headers.get('content-length');
        if (contentLength && Number(contentLength) > MAX_PROXY_BYTES) {
            return NextResponse.json({ error: 'File is too large' }, { status: 413 });
        }

        const responseHeaders: Record<string, string> = {
            'Content-Type': contentType as string,
            // The type was checked above; the browser must not second-guess it.
            'X-Content-Type-Options': 'nosniff',
            // Allow embedding in same-origin iframes
            'X-Frame-Options': 'SAMEORIGIN',
            // Conservative cache — signed URLs are short-lived anyway
            'Cache-Control': 'private, max-age=3300',
        };
        // Anything that is not a PDF or image is data: give it no script capability at all.
        if (!/^(application\/pdf|image\/)/i.test(contentType as string)) {
            responseHeaders['Content-Security-Policy'] = "sandbox; default-src 'none'";
        }

        if (contentLength) {
            responseHeaders['Content-Length'] = contentLength;
        }

        return new NextResponse(fileRes.body ? limitStream(fileRes.body, MAX_PROXY_BYTES) : null, {
            status: 200,
            headers: responseHeaders,
        });
    } catch (error) {
        console.error('[file-proxy] Unexpected error:', error);
        return NextResponse.json(
            {
                error: 'File proxy failed',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 },
        );
    }
}
