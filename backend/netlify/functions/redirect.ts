import { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import UAParser from "ua-parser-js";

interface QRRecord {
  id: string;
  name: string;
  url: string;
  category: string;
  folder: string;
  status: "active" | "inactive";
  createdAt: string;
  modifiedAt: string;
  customization: Record<string, any>;
}

interface ScanEvent {
  qrId: string;
  timestamp: string;
  country: string;
  city: string;
  region: string;
  timezone: string;
  latitude: number;
  longitude: number;
  deviceType: string;
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  userAgent: string;
  referer: string;
  language: string;
  ip: string;
}

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  const qrId = pathParts[pathParts.length - 1];

  if (!qrId) {
    return new Response("QR code not found", { status: 404 });
  }

  const qrStore = getStore("qr-records");

  // Get QR record
  const raw = await qrStore.get(qrId);
  if (!raw) {
    return new Response(inactivePage("QR Code Not Found", "This QR code does not exist."), {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  }

  const record: QRRecord = JSON.parse(raw);

  // If inactive, show deactivated page
  if (record.status === "inactive") {
    return new Response(
      inactivePage("QR Code Deactivated", "This QR code has been deactivated by its owner."),
      { status: 410, headers: { "Content-Type": "text/html" } }
    );
  }

  // Track the scan
  try {
    const ua = new UAParser(request.headers.get("user-agent") || "");
    const geo = context.geo;

    const scanEvent: ScanEvent = {
      qrId,
      timestamp: new Date().toISOString(),
      country: geo?.country?.name || geo?.country?.code || "Unknown",
      city: geo?.city || "Unknown",
      region: geo?.subdivision?.name || "Unknown",
      timezone: geo?.timezone || "Unknown",
      latitude: geo?.latitude || 0,
      longitude: geo?.longitude || 0,
      deviceType: ua.getDevice().type || "desktop",
      browser: ua.getBrowser().name || "Unknown",
      browserVersion: ua.getBrowser().version || "",
      os: ua.getOS().name || "Unknown",
      osVersion: ua.getOS().version || "",
      userAgent: request.headers.get("user-agent") || "",
      referer: request.headers.get("referer") || "direct",
      language: request.headers.get("accept-language")?.split(",")[0] || "Unknown",
      ip: context.ip || "",
    };

    // Store scan event
    const scanStore = getStore("scan-events");
    const scanKey = `${qrId}:${Date.now()}`;
    await scanStore.set(scanKey, JSON.stringify(scanEvent));

    // Increment scan count
    const countStore = getStore("scan-counts");
    const countRaw = await countStore.get(qrId);
    const currentCount = countRaw ? parseInt(countRaw, 10) : 0;
    await countStore.set(qrId, String(currentCount + 1));
  } catch (_e) {
    // Don't block redirect on tracking failure
  }

  // Redirect to target URL
  return Response.redirect(record.url, 302);
};

function inactivePage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f5f5f5; color: #333; }
    .card { background: white; border-radius: 12px; padding: 48px; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,0.08); max-width: 400px; }
    .icon { width: 64px; height: 64px; margin: 0 auto 16px; color: #f24822; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    p { font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export const config = {
  path: "/r/:id",
};
