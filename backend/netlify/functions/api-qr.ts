import { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

interface QRRecord {
  id: string;
  name: string;
  url: string;
  category: string;
  folder: string;
  status: "active" | "inactive";
  createdAt: string;
  modifiedAt: string;
  sourceType: string;
  customization: Record<string, any>;
  svgData?: string;
  scans?: number;
}

const API_KEY = process.env.QR_API_KEY || "dev-key";

function checkAuth(request: Request): boolean {
  const key = request.headers.get("X-API-Key") || request.headers.get("authorization")?.replace("Bearer ", "");
  return key === API_KEY;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Content-Type": "application/json",
  };
}

export default async (request: Request, context: Context) => {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }

  if (!checkAuth(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: cors(),
    });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.replace("/api/qr", "").split("/").filter(Boolean);
  const qrId = pathParts[0] || null;
  const qrStore = getStore("qr-records");
  const countStore = getStore("scan-counts");

  try {
    switch (request.method) {
      // LIST all or GET single
      case "GET": {
        if (qrId) {
          const raw = await qrStore.get(qrId);
          if (!raw) {
            return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: cors() });
          }
          const record: QRRecord = JSON.parse(raw);
          const countRaw = await countStore.get(qrId);
          record.scans = countRaw ? parseInt(countRaw, 10) : 0;
          return new Response(JSON.stringify(record), { headers: cors() });
        }

        // List all
        const { blobs } = await qrStore.list();
        const records: QRRecord[] = [];
        for (const blob of blobs) {
          const raw = await qrStore.get(blob.key);
          if (raw) {
            const record: QRRecord = JSON.parse(raw);
            const countRaw = await countStore.get(record.id);
            record.scans = countRaw ? parseInt(countRaw, 10) : 0;
            records.push(record);
          }
        }
        // Sort newest first
        records.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
        return new Response(JSON.stringify(records), { headers: cors() });
      }

      // CREATE
      case "POST": {
        const body: QRRecord = await request.json();
        const id = body.id || `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        const record: QRRecord = {
          id,
          name: body.name || "Untitled",
          url: body.url,
          category: body.category || "Website",
          folder: body.folder || "",
          status: "active",
          createdAt: now,
          modifiedAt: now,
          sourceType: body.sourceType || "url",
          customization: body.customization || {},
          svgData: body.svgData,
        };
        await qrStore.set(id, JSON.stringify(record));
        await countStore.set(id, "0");

        // Return with the redirect URL
        const siteUrl = process.env.URL || url.origin;
        return new Response(JSON.stringify({ ...record, scans: 0, redirectUrl: `${siteUrl}/r/${id}` }), {
          status: 201,
          headers: cors(),
        });
      }

      // UPDATE
      case "PATCH": {
        if (!qrId) {
          return new Response(JSON.stringify({ error: "ID required" }), { status: 400, headers: cors() });
        }
        const existing = await qrStore.get(qrId);
        if (!existing) {
          return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: cors() });
        }
        const current: QRRecord = JSON.parse(existing);
        const updates = await request.json();
        const updated: QRRecord = {
          ...current,
          ...updates,
          id: qrId, // prevent ID change
          modifiedAt: new Date().toISOString(),
        };
        await qrStore.set(qrId, JSON.stringify(updated));
        const countRaw = await countStore.get(qrId);
        updated.scans = countRaw ? parseInt(countRaw, 10) : 0;
        return new Response(JSON.stringify(updated), { headers: cors() });
      }

      // DELETE
      case "DELETE": {
        if (!qrId) {
          return new Response(JSON.stringify({ error: "ID required" }), { status: 400, headers: cors() });
        }
        await qrStore.delete(qrId);
        await countStore.delete(qrId);
        // Also delete scan events
        const scanStore = getStore("scan-events");
        const { blobs } = await scanStore.list({ prefix: `${qrId}:` });
        for (const blob of blobs) {
          await scanStore.delete(blob.key);
        }
        return new Response(JSON.stringify({ deleted: true }), { headers: cors() });
      }

      default:
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors() });
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors() });
  }
};

export const config = {
  path: ["/api/qr", "/api/qr/:id"],
};
