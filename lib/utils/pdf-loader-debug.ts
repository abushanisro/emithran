/**
 * PDF Loading Diagnostic Tool
 * Principal Engineer Solution for Domain Mismatch Issues
 */

export class PDFLoaderDebug {
  private static logPrefix = '[PDF-DEBUG]';

  /**
   * Clean and validate PDF URL before loading
   */
  static validatePDFUrl(url: string): string {
    console.log(`${this.logPrefix} Original URL:`, url);
    
    // Check for domain mismatches and force correction
    if (url.includes('emuski.jiobase.com') || url.includes('jiobase.com')) {
      console.warn(`${this.logPrefix} WARNING: Old domain detected - ${url}`);
      // Replace with correct Supabase domain
      const correctedUrl = url.replace(
        /emuski\.jiobase\.com|.*\.jiobase\.com/g, 
        'iuvtsvjpmovfymvnmqys.supabase.co'
      );
      console.log(`${this.logPrefix} Corrected URL:`, correctedUrl);
      return correctedUrl;
    }

    // Ensure proper Supabase domain
    if (!url.includes('supabase.co') && !url.startsWith('blob:') && !url.startsWith('data:')) {
      console.warn(`${this.logPrefix} WARNING: Non-Supabase URL detected - ${url}`);
    }

    // Add cache-busting parameter to fresh signed URLs
    if (url.includes('supabase.co') && !url.includes('_cb=')) {
      const separator = url.includes('?') ? '&' : '?';
      const cacheBustedUrl = `${url}${separator}_cb=${Date.now()}`;
      console.log(`${this.logPrefix} Cache-busted URL:`, cacheBustedUrl);
      return cacheBustedUrl;
    }

    console.log(`${this.logPrefix} Validated URL:`, url);
    return url;
  }

  /**
   * Test connectivity to PDF URL
   */
  static async testPDFConnectivity(url: string): Promise<boolean> {
    try {
      console.log(`${this.logPrefix} Testing connectivity to:`, url);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-cache'
      });
      
      clearTimeout(timeoutId);
      
      console.log(`${this.logPrefix} Connection test result:`, {
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      return response.ok;
    } catch (error: any) {
      console.error(`${this.logPrefix} Connection test failed:`, {
        error: error.message,
        name: error.name,
        url
      });
      return false;
    }
  }

  /**
   * Clear PDF-related cache
   */
  static clearPDFCache(): void {
    console.log(`${this.logPrefix} Clearing PDF cache...`);
    
    // Clear localStorage entries
    const keys = Object.keys(localStorage);
    const pdfKeys = keys.filter(key => 
      key.includes('pdf') || 
      key.includes('file') || 
      key.includes('jiobase') ||
      key.includes('supabase')
    );
    
    pdfKeys.forEach(key => {
      console.log(`${this.logPrefix} Removing localStorage key:`, key);
      localStorage.removeItem(key);
    });

    // Clear sessionStorage entries
    const sessionKeys = Object.keys(sessionStorage);
    const sessionPdfKeys = sessionKeys.filter(key => 
      key.includes('pdf') || 
      key.includes('file') || 
      key.includes('jiobase') ||
      key.includes('supabase')
    );
    
    sessionPdfKeys.forEach(key => {
      console.log(`${this.logPrefix} Removing sessionStorage key:`, key);
      sessionStorage.removeItem(key);
    });
  }

  /**
   * Force refresh file URL from backend
   */
  static async refreshFileUrl(fileId: string): Promise<string | null> {
    try {
      console.log(`${this.logPrefix} Refreshing file URL for ID:`, fileId);
      
      const response = await fetch(`/v1/api/bom-items/${fileId}/file-url/2d?_refresh=${Date.now()}`, {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const newUrl = data.fileUrl || data.url;
      
      console.log(`${this.logPrefix} Refreshed URL:`, newUrl);
      return newUrl;
      
    } catch (error: any) {
      console.error(`${this.logPrefix} Failed to refresh URL:`, error.message);
      return null;
    }
  }
}