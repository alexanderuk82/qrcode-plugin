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
  uniqueVisitors: number;
  avgScansPerDay: number;
  trendPercent: number;
  peakHour: { hour: number; count: number };
  peakDay: { date: string; count: number };
  deviceSplit: { mobile: number; desktop: number; tablet: number };
  scanVelocity: { last24h: number; last7d: number; last30d: number };
  topCountries: { name: string; count: number }[];
  topCities: { name: string; count: number }[];
  topDevices: { name: string; count: number }[];
  topBrowsers: { name: string; count: number }[];
  topOS: { name: string; count: number }[];
  topReferers: { name: string; count: number }[];
  topLanguages: { name: string; count: number }[];
  refererCategories: { name: string; count: number }[];
  topQRCodes: { id: string; name: string; scans: number; url: string }[];
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

const SOCIAL_DOMAINS = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'pinterest.com', 'reddit.com', 'youtube.com', 'snapchat.com', 'threads.net', 'mastodon.social'];
const SEARCH_DOMAINS = ['google.', 'bing.com', 'yahoo.', 'duckduckgo.com', 'baidu.com', 'yandex.', 'ecosia.org', 'brave.com'];

function categorizeReferer(referer: string): string {
  if (!referer || referer === 'direct' || referer === 'Unknown') return 'Direct';
  const lower = referer.toLowerCase();
  if (SOCIAL_DOMAINS.some(d => lower.includes(d))) return 'Social Media';
  if (SEARCH_DOMAINS.some(d => lower.includes(d))) return 'Search Engine';
  return 'Other';
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

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = parseInt(url.searchParams.get("limit") || "500", 10);

  try {
    const scanStore = getStore("scan-events");

    if (!qrId) {
      const { blobs } = await scanStore.list();
      const allEvents: ScanEvent[] = [];
      for (const blob of blobs.slice(0, limit)) {
        const raw = await scanStore.get(blob.key);
        if (raw) allEvents.push(JSON.parse(raw));
      }
      const summary = await buildSummary(allEvents, from, to);
      return new Response(JSON.stringify(summary), { headers: cors() });
    }

    const { blobs } = await scanStore.list({ prefix: `${qrId}:` });
    const allEvents: ScanEvent[] = [];
    for (const blob of blobs) {
      const raw = await scanStore.get(blob.key);
      if (raw) allEvents.push(JSON.parse(raw));
    }
    const summary = await buildSummary(allEvents, from, to);
    return new Response(JSON.stringify(summary), { headers: cors() });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors() });
  }
};

async function buildSummary(allEvents: ScanEvent[], from: string | null, to: string | null): Promise<AnalyticsSummary> {
  // Filter by date range
  let events = allEvents;
  if (from) events = events.filter(e => e.timestamp >= from);
  if (to) events = events.filter(e => e.timestamp <= to);

  // Sort by timestamp desc
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const now = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // === Trend: compare current period vs previous period ===
  let trendPercent = 0;
  if (from) {
    const fromDate = new Date(from);
    const periodMs = now.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - periodMs).toISOString();
    const prevEvents = allEvents.filter(e => e.timestamp >= prevFrom && e.timestamp < from);
    if (prevEvents.length > 0) {
      trendPercent = Math.round(((events.length - prevEvents.length) / prevEvents.length) * 100);
    } else if (events.length > 0) {
      trendPercent = 100;
    }
  }

  // === Unique visitors (by IP) ===
  const uniqueIps = new Set(events.map(e => e.ip).filter(Boolean));
  const uniqueVisitors = uniqueIps.size;

  // === Avg scans per day ===
  const uniqueDays = new Set(events.map(e => e.timestamp.split("T")[0]));
  const avgScansPerDay = uniqueDays.size > 0 ? Math.round((events.length / uniqueDays.size) * 10) / 10 : 0;

  // === Scans by day ===
  const byDay = countBy(events, e => e.timestamp.split("T")[0]);

  // === Peak day ===
  const peakDayEntry = byDay.length > 0 ? byDay[0] : { name: '', count: 0 };
  const peakDay = { date: peakDayEntry.name, count: peakDayEntry.count };

  // === Scans by hour ===
  const hourMap = new Map<number, number>();
  for (const e of events) {
    const hour = new Date(e.timestamp).getUTCHours();
    hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
  }
  const scansByHour = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: hourMap.get(i) || 0,
  }));

  // === Peak hour ===
  const peakHourEntry = scansByHour.reduce((a, b) => a.count >= b.count ? a : b, { hour: 0, count: 0 });
  const peakHour = { hour: peakHourEntry.hour, count: peakHourEntry.count };

  // === Scans by day of week ===
  const dowMap = new Map<string, number>();
  for (const e of events) {
    const day = days[new Date(e.timestamp).getUTCDay()];
    dowMap.set(day, (dowMap.get(day) || 0) + 1);
  }
  const scansByDayOfWeek = days.map(day => ({
    day,
    count: dowMap.get(day) || 0,
  }));

  // === Device split (percentages) ===
  const deviceCounts = { mobile: 0, desktop: 0, tablet: 0 };
  for (const e of events) {
    const dt = (e.deviceType || 'desktop').toLowerCase();
    if (dt === 'mobile') deviceCounts.mobile++;
    else if (dt === 'tablet') deviceCounts.tablet++;
    else deviceCounts.desktop++;
  }
  const total = events.length || 1;
  const deviceSplit = {
    mobile: Math.round((deviceCounts.mobile / total) * 100),
    desktop: Math.round((deviceCounts.desktop / total) * 100),
    tablet: Math.round((deviceCounts.tablet / total) * 100),
  };

  // === Scan velocity ===
  const nowMs = now.getTime();
  const scanVelocity = {
    last24h: allEvents.filter(e => nowMs - new Date(e.timestamp).getTime() < 86400000).length,
    last7d: allEvents.filter(e => nowMs - new Date(e.timestamp).getTime() < 7 * 86400000).length,
    last30d: allEvents.filter(e => nowMs - new Date(e.timestamp).getTime() < 30 * 86400000).length,
  };

  // === Referer categories ===
  const refererCategories = countBy(events, e => categorizeReferer(e.referer));

  // === Top languages ===
  const topLanguages = countBy(events, e => {
    const lang = (e.language || 'Unknown').split('-')[0].split(';')[0].trim();
    return lang || 'Unknown';
  }).slice(0, 10);

  // === Top QR codes (with names from qr-records store) ===
  const qrScanCounts = new Map<string, number>();
  for (const e of events) {
    qrScanCounts.set(e.qrId, (qrScanCounts.get(e.qrId) || 0) + 1);
  }
  const topQRCodes: { id: string; name: string; scans: number; url: string }[] = [];
  try {
    const qrStore = getStore("qr-records");
    const sortedQrs = Array.from(qrScanCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [id, scans] of sortedQrs) {
      const raw = await qrStore.get(id);
      if (raw) {
        const record = JSON.parse(raw);
        topQRCodes.push({ id, name: record.name || 'Untitled', scans, url: record.url || '' });
      } else {
        topQRCodes.push({ id, name: id, scans, url: '' });
      }
    }
  } catch {
    // If qr-records store fails, just use IDs
    const sortedQrs = Array.from(qrScanCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [id, scans] of sortedQrs) {
      topQRCodes.push({ id, name: id, scans, url: '' });
    }
  }

  // === Scan locations ===
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
    uniqueVisitors,
    avgScansPerDay,
    trendPercent,
    peakHour,
    peakDay,
    deviceSplit,
    scanVelocity,
    topCountries: countBy(events, e => e.country).slice(0, 20),
    topCities: countBy(events, e => `${e.city}, ${e.country}`).slice(0, 20),
    topDevices: countBy(events, e => e.deviceType || "desktop").slice(0, 10),
    topBrowsers: countBy(events, e => e.browser).slice(0, 10),
    topOS: countBy(events, e => e.os).slice(0, 10),
    topReferers: countBy(events, e => e.referer).slice(0, 10),
    topLanguages,
    refererCategories,
    topQRCodes,
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
