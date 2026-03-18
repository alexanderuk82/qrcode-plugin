import { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

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

interface AnalyticsSummary {
  totalScans: number;
  uniqueCountries: number;
  uniqueCities: number;
  topCountries: { name: string; count: number }[];
  topCities: { name: string; count: number }[];
  topDevices: { name: string; count: number }[];
  topBrowsers: { name: string; count: number }[];
  topOS: { name: string; count: number }[];
  topReferers: { name: string; count: number }[];
  scansByDay: { date: string; count: number }[];
  scansByHour: { hour: number; count: number }[];
  scansByDayOfWeek: { day: string; count: number }[];
  recentScans: ScanEvent[];
  scanLocations: { lat: number; lng: number; city: string; country: string; count: number }[];
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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}

function countBy<T>(arr: T[], keyFn: (item: T) => string): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const item of arr) {
    const key = keyFn(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export default async (request: Request, context: Context) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }

  if (!checkAuth(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors() });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.replace("/api/analytics", "").split("/").filter(Boolean);
  const qrId = pathParts[0] || null;

  // Query params for date range
  const from = url.searchParams.get("from"); // ISO date
  const to = url.searchParams.get("to"); // ISO date
  const limit = parseInt(url.searchParams.get("limit") || "500", 10);

  try {
    const scanStore = getStore("scan-events");

    if (!qrId) {
      // Global analytics - all QR codes
      const { blobs } = await scanStore.list();
      const events: ScanEvent[] = [];
      for (const blob of blobs.slice(0, limit)) {
        const raw = await scanStore.get(blob.key);
        if (raw) events.push(JSON.parse(raw));
      }
      const summary = buildSummary(events, from, to);
      return new Response(JSON.stringify(summary), { headers: cors() });
    }

    // Analytics for specific QR code
    const { blobs } = await scanStore.list({ prefix: `${qrId}:` });
    const events: ScanEvent[] = [];
    for (const blob of blobs) {
      const raw = await scanStore.get(blob.key);
      if (raw) events.push(JSON.parse(raw));
    }
    const summary = buildSummary(events, from, to);
    return new Response(JSON.stringify(summary), { headers: cors() });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors() });
  }
};

function buildSummary(allEvents: ScanEvent[], from: string | null, to: string | null): AnalyticsSummary {
  // Filter by date range
  let events = allEvents;
  if (from) events = events.filter(e => e.timestamp >= from);
  if (to) events = events.filter(e => e.timestamp <= to);

  // Sort by timestamp desc
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Scans by day
  const byDay = countBy(events, e => e.timestamp.split("T")[0]);

  // Scans by hour
  const hourMap = new Map<number, number>();
  for (const e of events) {
    const hour = new Date(e.timestamp).getUTCHours();
    hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
  }
  const scansByHour = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: hourMap.get(i) || 0,
  }));

  // Scans by day of week
  const dowMap = new Map<string, number>();
  for (const e of events) {
    const day = days[new Date(e.timestamp).getUTCDay()];
    dowMap.set(day, (dowMap.get(day) || 0) + 1);
  }
  const scansByDayOfWeek = days.map(day => ({
    day,
    count: dowMap.get(day) || 0,
  }));

  // Scan locations (group by city+country)
  const locMap = new Map<string, { lat: number; lng: number; city: string; country: string; count: number }>();
  for (const e of events) {
    if (e.latitude && e.longitude) {
      const key = `${e.city}|${e.country}`;
      const existing = locMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        locMap.set(key, { lat: e.latitude, lng: e.longitude, city: e.city, country: e.country, count: 1 });
      }
    }
  }

  const countries = new Set(events.map(e => e.country).filter(c => c !== "Unknown"));
  const cities = new Set(events.map(e => e.city).filter(c => c !== "Unknown"));

  return {
    totalScans: events.length,
    uniqueCountries: countries.size,
    uniqueCities: cities.size,
    topCountries: countBy(events, e => e.country).slice(0, 20),
    topCities: countBy(events, e => `${e.city}, ${e.country}`).slice(0, 20),
    topDevices: countBy(events, e => e.deviceType || "desktop").slice(0, 10),
    topBrowsers: countBy(events, e => e.browser).slice(0, 10),
    topOS: countBy(events, e => e.os).slice(0, 10),
    topReferers: countBy(events, e => e.referer).slice(0, 10),
    scansByDay: byDay.reverse().slice(0, 90),
    scansByHour,
    scansByDayOfWeek,
    recentScans: events.slice(0, 50),
    scanLocations: Array.from(locMap.values()).sort((a, b) => b.count - a.count).slice(0, 50),
  };
}

export const config = {
  path: ["/api/analytics", "/api/analytics/:id"],
};
