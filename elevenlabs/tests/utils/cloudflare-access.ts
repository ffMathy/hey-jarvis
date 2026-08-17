/**
 * Service token headers for the Cloudflare Access application in front of the
 * tunnel, the same pair production's MCP integration sends.
 *
 * Returns nothing when the token is not configured, so these checks keep working
 * against a hostname that has no Access application in front of it yet. Once one
 * is added, requests without these headers get a 403 rather than the server.
 */
export function cloudflareAccessHeaders(): Record<string, string> {
  const clientId = process.env.HEY_JARVIS_CLOUDFLARE_ACCESS_CLIENT_ID;
  const clientSecret = process.env.HEY_JARVIS_CLOUDFLARE_ACCESS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {};
  }

  return {
    'CF-Access-Client-Id': clientId,
    'CF-Access-Client-Secret': clientSecret,
  };
}
