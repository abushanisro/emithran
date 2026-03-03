import { useState, useEffect } from 'react';
import { Loader2, FileText, AlertCircle, Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Viewer2DProps {
    fileUrl: string;
    fileName: string;
    fileType: 'pdf' | 'img' | 'other';
}

/**
 * Build a same-origin proxy URL for a given Supabase signed URL.
 *
 * Why: Chrome blocks cross-site iframes that load Supabase signed URLs
 * (sec-fetch-site: cross-site + sec-fetch-dest: iframe → browser blocks it).
 *
 * Fix: Route the PDF through /api/file-proxy so the iframe src is
 * localhost:3000 (same-origin) and Chrome allows it unconditionally.
 */
function toProxyUrl(signedUrl: string): string {
    return `/api/file-proxy?url=${encodeURIComponent(signedUrl)}`;
}

export function Viewer2D({ fileUrl, fileName, fileType }: Viewer2DProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [zoom, setZoom] = useState(100);
    // For PDFs we always use the proxy; for images we can use the direct URL
    // after a quick reachability check.
    const [resolvedUrl, setResolvedUrl] = useState<string>('');

    useEffect(() => {
        if (!fileUrl) return;

        if (fileType === 'pdf') {
            // Always proxy PDFs — avoids cross-site iframe Chrome block
            setResolvedUrl(toProxyUrl(fileUrl));
            setError(false);
        } else {
            // For images, use the signed URL directly (images are not subject
            // to the cross-site iframe restriction).
            setResolvedUrl(fileUrl);
            setError(false);
        }
    }, [fileUrl, fileType]);

    const handleLoad = () => {
        setLoading(false);
    };

    const handleError = () => {
        setLoading(false);
        setError(true);
    };

    if (!fileUrl) {
        return (
            <div className="flex flex-col items-center justify-center h-full w-full bg-secondary/20 p-4 text-center">
                <FileText className="h-10 w-10 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No file selected</p>
            </div>
        );
    }

    return (
        <div className="relative w-full h-full bg-background flex flex-col">
            {/* Toolbar */}
            <div className="flex items-center justify-between p-2 border-b bg-card">
                <span className="text-xs font-medium truncate max-w-[150px]" title={fileName}>
                    {fileName}
                </span>
                <div className="flex items-center gap-1">
                    {fileType === 'img' && (
                        <>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => setZoom(Math.max(10, zoom - 10))}
                                title="Zoom Out"
                            >
                                <ZoomOut className="h-3 w-3" />
                            </Button>
                            <span className="text-[10px] w-8 text-center">{zoom}%</span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => setZoom(Math.min(500, zoom + 10))}
                                title="Zoom In"
                            >
                                <ZoomIn className="h-3 w-3" />
                            </Button>
                        </>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        asChild
                        title="Open in new tab"
                    >
                        {/* Open the original signed URL in a new tab (not the proxy) */}
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                            <Maximize className="h-3 w-3" />
                        </a>
                    </Button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 relative overflow-hidden bg-secondary/10">
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                )}

                {error ? (
                    <div className="flex flex-col items-center justify-center p-4 text-center">
                        <AlertCircle className="h-8 w-8 text-destructive mb-2" />
                        <p className="text-sm font-medium">Failed to load preview</p>
                        <Button variant="link" size="sm" asChild className="mt-2">
                            <a href={fileUrl} target="_blank" rel="noopener noreferrer">Download File</a>
                        </Button>
                    </div>
                ) : (
                    <>
                        {fileType === 'pdf' ? (
                            <iframe
                                key={resolvedUrl}
                                src={resolvedUrl ? `${resolvedUrl}#view=FitV&zoom=page-actual&scrollbar=0&toolbar=0&navpanes=0&statusbar=0&messages=0&page=1` : ''}
                                className="w-full h-full border-0"
                                style={{ overflow: 'hidden', border: 'none', margin: '0', padding: '0' }}
                                onLoad={handleLoad}
                                onError={handleError}
                                title={fileName}
                                scrolling="no"
                                frameBorder="0"
                                marginHeight="0"
                                marginWidth="0"
                            />
                        ) : fileType === 'img' ? (
                            <div className="overflow-auto w-full h-full flex items-center justify-center p-4">
                                <img
                                    src={resolvedUrl || fileUrl}
                                    alt={fileName}
                                    className="max-w-none transition-transform duration-200"
                                    style={{ transform: `scale(${zoom / 100})` }}
                                    onLoad={handleLoad}
                                    onError={handleError}
                                />
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center p-4 text-center">
                                <FileText className="h-10 w-10 text-muted-foreground mb-2" />
                                <p className="text-sm font-medium">Preview not available</p>
                                <Button variant="outline" size="sm" asChild className="mt-4">
                                    <a href={fileUrl} target="_blank" rel="noopener noreferrer">Download to View</a>
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
