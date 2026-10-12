export function validateCsrfOrigin(req: Request): boolean {
  // Safe methods don't need CSRF origin validation
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return true;
  }

  const origin = req.headers.get('origin');
  const host = req.headers.get('host') || req.headers.get('x-forwarded-host');
  const secFetchSite = req.headers.get('sec-fetch-site');

  // If browser sent sec-fetch-site: cross-site, reject
  if (secFetchSite === 'cross-site') {
    return false;
  }

  // If no origin (e.g., direct cURL or non-browser tool), check referer
  if (!origin) {
    const referer = req.headers.get('referer');
    if (!referer) {
      // In development or automated test calls without Origin/Referer
      return true;
    }
    try {
      const refererUrl = new URL(referer);
      if (host && refererUrl.host !== host) {
        return false;
      }
    } catch {
      return false;
    }
    return true;
  }

  try {
    const originUrl = new URL(origin);
    if (host) {
      // Compare hostnames/ports
      if (originUrl.host.toLowerCase() !== host.toLowerCase()) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL;
        if (appUrl) {
          try {
            const parsedApp = new URL(appUrl);
            if (originUrl.host.toLowerCase() === parsedApp.host.toLowerCase()) {
              return true;
            }
          } catch {
            // ignore
          }
        }
        return false;
      }
    }
  } catch {
    return false;
  }

  return true;
}
