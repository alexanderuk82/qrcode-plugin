import { generateQRSvg, generateQRDataUrl, generateQRPngDataUrl } from './qr-engine';
import type { QRSvgOptions, ECLevel, QRStyle } from './qr-engine';

// === Types ===
interface QRCodeRecord {
  id: string;
  name: string;
  url: string;
  category: string;
  folder: string;
  createdAt: string;
  modifiedAt: string;
  scans: number;
  status: 'active' | 'inactive';
  sourceType: 'url' | 'frame';
  frameId?: string;
  frameName?: string;
  customization: {
    foreground: string;
    background: string;
    errorCorrection: ECLevel;
    size: number;
    margin: number;
    style: QRStyle;
  };
  svgData?: string;
}

// === State ===
let records: QRCodeRecord[] = [];
let selectedIds = new Set<string>();
let currentView: 'dashboard' | 'create' | 'detail' = 'dashboard';
let editingRecord: QRCodeRecord | null = null;
let detailRecord: QRCodeRecord | null = null;
let currentSvg = '';
let selectedFrame: { id: string; name: string } | null = null;
let exportFormat: 'svg' | 'png' | 'embed' = 'svg';
let sourceType: 'url' | 'frame' = 'url';
let qrStyle: QRStyle = 'square';
let previewTimeout: ReturnType<typeof setTimeout> | null = null;

// === DOM helpers ===
const getEl = (id: string) => document.getElementById(id)!;
const queryAll = (sel: string, root: Element | Document = document) => root.querySelectorAll(sel);

function postMsg(msg: any) {
  parent.postMessage({ pluginMessage: msg }, '*');
}

function showToast(text: string) {
  const toast = getEl('toast');
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function generateId(): string {
  return `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function truncateUrl(url: string, max = 28): string {
  if (url.length <= max) return url;
  return url.slice(0, max) + '...';
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

// === QR Data Generators per Category ===
type QRCategory = 'Website' | 'Social Media' | 'Email' | 'Phone' | 'SMS' | 'WiFi' | 'vCard' | 'Event' | 'Geo Location' | 'Payment' | 'Product' | 'Menu' | 'Other';

const CATEGORY_FIELDS: Record<QRCategory, { label: string; fields: { id: string; label: string; type: string; placeholder: string; required?: boolean }[] }> = {
  'Website': {
    label: 'Website URL',
    fields: [
      { id: 'f-url', label: 'URL', type: 'url', placeholder: 'example.com', required: true },
    ],
  },
  'Social Media': {
    label: 'Social Media URL',
    fields: [
      { id: 'f-url', label: 'Profile URL', type: 'url', placeholder: 'instagram.com/username', required: true },
    ],
  },
  'Email': {
    label: 'Email',
    fields: [
      { id: 'f-email', label: 'Email Address', type: 'email', placeholder: 'hello@example.com', required: true },
      { id: 'f-subject', label: 'Subject', type: 'text', placeholder: 'Optional subject' },
      { id: 'f-body', label: 'Body', type: 'text', placeholder: 'Optional message body' },
    ],
  },
  'Phone': {
    label: 'Phone Call',
    fields: [
      { id: 'f-phone', label: 'Phone Number', type: 'tel', placeholder: '+1 555 123 4567', required: true },
    ],
  },
  'SMS': {
    label: 'SMS Message',
    fields: [
      { id: 'f-phone', label: 'Phone Number', type: 'tel', placeholder: '+1 555 123 4567', required: true },
      { id: 'f-body', label: 'Message', type: 'text', placeholder: 'Optional pre-filled message' },
    ],
  },
  'WiFi': {
    label: 'WiFi Network',
    fields: [
      { id: 'f-ssid', label: 'Network Name (SSID)', type: 'text', placeholder: 'MyWiFiNetwork', required: true },
      { id: 'f-password', label: 'Password', type: 'text', placeholder: 'Network password' },
      { id: 'f-encryption', label: 'Encryption', type: 'select', placeholder: 'WPA/WPA2' },
      { id: 'f-hidden', label: 'Hidden Network', type: 'checkbox', placeholder: '' },
    ],
  },
  'vCard': {
    label: 'Contact Card',
    fields: [
      { id: 'f-firstname', label: 'First Name', type: 'text', placeholder: 'John', required: true },
      { id: 'f-lastname', label: 'Last Name', type: 'text', placeholder: 'Doe' },
      { id: 'f-phone', label: 'Phone', type: 'tel', placeholder: '+1 555 123 4567' },
      { id: 'f-email', label: 'Email', type: 'email', placeholder: 'john@example.com' },
      { id: 'f-org', label: 'Company', type: 'text', placeholder: 'Acme Inc.' },
      { id: 'f-title', label: 'Job Title', type: 'text', placeholder: 'Designer' },
      { id: 'f-url', label: 'Website', type: 'url', placeholder: 'example.com' },
    ],
  },
  'Event': {
    label: 'Calendar Event',
    fields: [
      { id: 'f-summary', label: 'Event Title', type: 'text', placeholder: 'Team Meeting', required: true },
      { id: 'f-location', label: 'Location', type: 'text', placeholder: '123 Main St' },
      { id: 'f-dtstart', label: 'Start Date/Time', type: 'datetime-local', placeholder: '', required: true },
      { id: 'f-dtend', label: 'End Date/Time', type: 'datetime-local', placeholder: '' },
      { id: 'f-description', label: 'Description', type: 'text', placeholder: 'Optional description' },
    ],
  },
  'Geo Location': {
    label: 'Geographic Location',
    fields: [
      { id: 'f-lat', label: 'Latitude', type: 'number', placeholder: '40.7128', required: true },
      { id: 'f-lng', label: 'Longitude', type: 'number', placeholder: '-74.0060', required: true },
    ],
  },
  'Payment': {
    label: 'Payment URL',
    fields: [
      { id: 'f-url', label: 'Payment URL', type: 'url', placeholder: 'paypal.me/username', required: true },
    ],
  },
  'Product': {
    label: 'Product URL',
    fields: [
      { id: 'f-url', label: 'Product URL', type: 'url', placeholder: 'example.com/product', required: true },
    ],
  },
  'Menu': {
    label: 'Menu URL',
    fields: [
      { id: 'f-url', label: 'Menu URL', type: 'url', placeholder: 'example.com/menu', required: true },
    ],
  },
  'Other': {
    label: 'Plain Text / Custom',
    fields: [
      { id: 'f-text', label: 'Content', type: 'text', placeholder: 'Any text or URL', required: true },
    ],
  },
};

function getFieldValue(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? el.value.trim() : '';
}

function getFieldChecked(id: string): boolean {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? el.checked : false;
}

function generateQRContent(category: QRCategory): string {
  switch (category) {
    case 'Website':
    case 'Social Media':
    case 'Payment':
    case 'Product':
    case 'Menu':
      return normalizeUrl(getFieldValue('f-url'));

    case 'Email': {
      const email = getFieldValue('f-email');
      const subject = getFieldValue('f-subject');
      const body = getFieldValue('f-body');
      let mailto = `mailto:${email}`;
      const params: string[] = [];
      if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
      if (body) params.push(`body=${encodeURIComponent(body)}`);
      if (params.length) mailto += '?' + params.join('&');
      return mailto;
    }

    case 'Phone': {
      const phone = getFieldValue('f-phone').replace(/\s+/g, '');
      return `tel:${phone}`;
    }

    case 'SMS': {
      const phone = getFieldValue('f-phone').replace(/\s+/g, '');
      const body = getFieldValue('f-body');
      let sms = `sms:${phone}`;
      if (body) sms += `?body=${encodeURIComponent(body)}`;
      return sms;
    }

    case 'WiFi': {
      const ssid = getFieldValue('f-ssid');
      const password = getFieldValue('f-password');
      const encEl = document.getElementById('f-encryption') as HTMLSelectElement | null;
      const encryption = encEl ? encEl.value : 'WPA';
      const hidden = getFieldChecked('f-hidden');
      // WIFI:T:WPA;S:mynetwork;P:mypass;H:true;;
      let wifi = `WIFI:T:${encryption};S:${escapeWifi(ssid)}`;
      if (password) wifi += `;P:${escapeWifi(password)}`;
      if (hidden) wifi += `;H:true`;
      wifi += ';;';
      return wifi;
    }

    case 'vCard': {
      const fn = getFieldValue('f-firstname');
      const ln = getFieldValue('f-lastname');
      const phone = getFieldValue('f-phone');
      const email = getFieldValue('f-email');
      const org = getFieldValue('f-org');
      const title = getFieldValue('f-title');
      const url = getFieldValue('f-url');
      let vcard = 'BEGIN:VCARD\nVERSION:3.0\n';
      vcard += `N:${ln};${fn};;;\n`;
      vcard += `FN:${fn}${ln ? ' ' + ln : ''}\n`;
      if (phone) vcard += `TEL:${phone}\n`;
      if (email) vcard += `EMAIL:${email}\n`;
      if (org) vcard += `ORG:${org}\n`;
      if (title) vcard += `TITLE:${title}\n`;
      if (url) vcard += `URL:${normalizeUrl(url)}\n`;
      vcard += 'END:VCARD';
      return vcard;
    }

    case 'Event': {
      const summary = getFieldValue('f-summary');
      const location = getFieldValue('f-location');
      const dtstart = getFieldValue('f-dtstart');
      const dtend = getFieldValue('f-dtend');
      const description = getFieldValue('f-description');
      const formatDt = (v: string) => v ? v.replace(/[-:]/g, '').replace('T', 'T') + '00' : '';
      let vevent = 'BEGIN:VEVENT\n';
      vevent += `SUMMARY:${summary}\n`;
      if (dtstart) vevent += `DTSTART:${formatDt(dtstart)}\n`;
      if (dtend) vevent += `DTEND:${formatDt(dtend)}\n`;
      if (location) vevent += `LOCATION:${location}\n`;
      if (description) vevent += `DESCRIPTION:${description}\n`;
      vevent += 'END:VEVENT';
      return vevent;
    }

    case 'Geo Location': {
      const lat = getFieldValue('f-lat');
      const lng = getFieldValue('f-lng');
      return `geo:${lat},${lng}`;
    }

    case 'Other':
      return getFieldValue('f-text');

    default:
      return getFieldValue('f-url') || getFieldValue('f-text') || '';
  }
}

function escapeWifi(str: string): string {
  return str.replace(/([\\;,:""])/g, '\\$1');
}

function renderDynamicFields(category: QRCategory) {
  const container = document.getElementById('dynamicFields')!;
  const config = CATEGORY_FIELDS[category];
  if (!config) return;

  container.innerHTML = config.fields.map(f => {
    if (f.type === 'select' && f.id === 'f-encryption') {
      return `
        <div class="form-group">
          <div class="form-label">${f.label}</div>
          <select class="select" id="${f.id}" style="width:100%;">
            <option value="WPA">WPA/WPA2</option>
            <option value="WEP">WEP</option>
            <option value="nopass">None (Open)</option>
          </select>
        </div>`;
    }
    if (f.type === 'checkbox') {
      return `
        <div class="form-group" style="flex-direction:row;align-items:center;gap:8px;">
          <input type="checkbox" id="${f.id}" style="width:14px;height:14px;">
          <div class="form-label" style="margin:0;">${f.label}</div>
        </div>`;
    }
    return `
      <div class="form-group">
        <div class="form-label">${f.label}${f.required ? ' *' : ''}</div>
        <input class="input" type="${f.type}" placeholder="${f.placeholder}" id="${f.id}" style="width:100%;">
      </div>`;
  }).join('');

  // Attach input listeners for live preview
  config.fields.forEach(f => {
    const el = document.getElementById(f.id);
    if (el) {
      el.addEventListener('input', debouncedPreview);
      el.addEventListener('change', debouncedPreview);
    }
  });
}

// === View Management ===
function switchView(view: 'dashboard' | 'create' | 'detail' | 'analytics') {
  currentView = view as any;
  getEl('viewDashboard').classList.toggle('active', view === 'dashboard');
  getEl('viewCreate').classList.toggle('active', view === 'create');
  getEl('viewDetail').classList.toggle('active', view === 'detail');
  getEl('viewAnalytics').classList.toggle('active', view === 'analytics');
}

// === Dashboard Rendering ===
function getFilteredRecords(): QRCodeRecord[] {
  const search = (getEl('searchInput') as HTMLInputElement).value.toLowerCase();
  const status = (getEl('filterStatus') as HTMLSelectElement).value;
  const category = (getEl('filterCategory') as HTMLSelectElement).value;
  const sort = (getEl('filterSort') as HTMLSelectElement).value;
  const quantity = parseInt((getEl('filterQuantity') as HTMLSelectElement).value);

  let filtered = records.filter(r => {
    if (search && !r.name.toLowerCase().includes(search) && !r.url.toLowerCase().includes(search)) return false;
    if (status !== 'all' && r.status !== status) return false;
    if (category !== 'all' && r.category !== category) return false;
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    switch (sort) {
      case 'newest': return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      case 'oldest': return new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
      case 'name': return a.name.localeCompare(b.name);
      case 'scans': return b.scans - a.scans;
      default: return 0;
    }
  });

  return filtered.slice(0, quantity);
}

function updateCategoryFilter() {
  const select = getEl('filterCategory') as HTMLSelectElement;
  const current = select.value;
  const cats = new Set(records.map(r => r.category));
  select.innerHTML = '<option value="all">All Types</option>';
  cats.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
  select.value = current;
}

function renderDashboard() {
  const filtered = getFilteredRecords();
  const container = getEl('listContainer');
  const empty = getEl('emptyState');
  const listHeader = getEl('listHeader');

  if (records.length === 0) {
    container.classList.add('hidden');
    listHeader.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  container.classList.remove('hidden');
  listHeader.classList.remove('hidden');
  empty.classList.add('hidden');

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="padding:40px;text-align:center;color:var(--figma-color-text-secondary);">
        No QR codes match your filters
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(record => {
    const isSelected = selectedIds.has(record.id);
    const isInactive = record.status === 'inactive';
    const qrPreviewUrl = record.svgData
      ? `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(record.svgData)))}`
      : '';

    return `
      <div class="qr-item${isInactive ? ' qr-inactive' : ''}" data-id="${record.id}">
        <div class="checkbox ${isSelected ? 'checked' : ''}" data-action="toggle" data-id="${record.id}"></div>
        <div class="qr-preview" data-action="show-qr" data-id="${record.id}" style="cursor:pointer;${isInactive ? 'opacity:0.3;filter:grayscale(1);' : ''}" title="${isInactive ? 'QR is inactive' : 'Click to enlarge'}">
          ${qrPreviewUrl ? `<img src="${qrPreviewUrl}" alt="QR">` : '<span style="font-size:9px;color:var(--figma-color-text-secondary);">N/A</span>'}
          ${isInactive ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;color:var(--figma-color-text-danger);text-transform:uppercase;letter-spacing:0.5px;pointer-events:none;">OFF</div>' : ''}
        </div>
        <div class="qr-info">
          <div class="qr-name-row">
            <span class="qr-category">${record.category}</span>
            <input class="qr-name-input" value="${record.name}" data-action="rename" data-id="${record.id}"${isInactive ? ' style="opacity:0.5;"' : ''}>
          </div>
          <div class="qr-meta">
            <span class="badge ${isInactive ? 'badge-inactive' : 'badge-active'}">${record.status}</span>
            <a href="#" data-action="copy-url" data-url="${record.url}" title="${record.url}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              ${truncateUrl(record.url)}
            </a>
          </div>
        </div>
        <div class="qr-folder" style="${record.folder ? 'color:var(--figma-color-text);' : ''}">
          <svg viewBox="0 0 24 24" fill="${record.folder ? 'var(--figma-color-text-brand)' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          ${record.folder || 'No folder'}
        </div>
        <div class="qr-date">
          <span style="font-size:9px;color:var(--figma-color-icon-secondary);">Modified</span>
          ${formatDate(record.modifiedAt)}
        </div>
        <div class="qr-scans">
          <div class="qr-scans-label">Scans</div>
          <div class="qr-scans-count">${record.scans}</div>
        </div>
        <div class="qr-actions">
          <button class="btn btn-sm btn-secondary" data-action="download" data-id="${record.id}"${isInactive ? ' disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </button>
          <button class="btn btn-sm btn-secondary" data-action="detail" data-id="${record.id}"${isInactive ? ' disabled' : ''}>Detail</button>
          <div class="menu-wrapper">
            <button class="btn btn-sm btn-ghost" data-action="menu" data-id="${record.id}">
              <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
            </button>
            <div class="menu" id="menu-${record.id}">
              ${isInactive ? '' : `<button class="menu-item" data-action="paste" data-id="${record.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8m-4-4h8"/></svg>
                Paste into Figma
              </button>
              <button class="menu-item" data-action="edit" data-id="${record.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit
              </button>`}
              <button class="menu-item" data-action="toggle-status" data-id="${record.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${isInactive
                  ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
                  : '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/>'}</svg>
                ${isInactive ? 'Activate' : 'Deactivate'}
              </button>
              <div class="menu-divider"></div>
              <button class="menu-item danger" data-action="delete" data-id="${record.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');

  updateBulkBar();
}

function updateBulkBar() {
  const bar = getEl('bulkBar');
  const count = getEl('bulkCount');
  const selectAll = getEl('selectAll');

  if (selectedIds.size > 0) {
    bar.classList.add('visible');
    count.textContent = String(selectedIds.size);
    selectAll.classList.add('checked');
  } else {
    bar.classList.remove('visible');
    selectAll.classList.remove('checked');
  }
}

// === Create/Edit View ===
function getCurrentOptions(): QRSvgOptions {
  return {
    text: ((getEl('inputUrl') as HTMLInputElement).value || 'https://example.com'),
    errorCorrection: (getEl('inputEC') as HTMLSelectElement).value as ECLevel,
    size: parseInt((getEl('inputSize') as HTMLInputElement).value) || 256,
    margin: parseInt((getEl('inputMargin') as HTMLInputElement).value) || 4,
    foreground: (getEl('colorFgHex') as HTMLInputElement).value || '#000000',
    background: (getEl('colorBgHex') as HTMLInputElement).value || '#FFFFFF',
    style: qrStyle,
  };
}

function updatePreview() {
  const preview = getEl('previewQr');
  const btnPaste = getEl('btnPasteToFigma') as HTMLButtonElement;
  const btnDownload = getEl('btnDownload') as HTMLButtonElement;
  const btnSave = getEl('btnSave') as HTMLButtonElement;
  const category = (getEl('inputCategory') as HTMLSelectElement).value as QRCategory;

  if (sourceType === 'frame' && !selectedFrame) {
    preview.innerHTML = '<div class="placeholder">Select a frame in Figma canvas</div>';
    btnPaste.disabled = true;
    btnDownload.disabled = true;
    btnSave.disabled = true;
    currentSvg = '';
    return;
  }

  const qrContent = sourceType === 'frame'
    ? `figma://frame/${selectedFrame!.id}`
    : generateQRContent(category);

  if (!qrContent) {
    preview.innerHTML = '<div class="placeholder">Fill in the fields to generate preview</div>';
    btnPaste.disabled = true;
    btnDownload.disabled = true;
    btnSave.disabled = true;
    currentSvg = '';
    return;
  }

  // Sync hidden inputUrl for backward compat
  (getEl('inputUrl') as HTMLInputElement).value = qrContent;

  try {
    const options = { ...getCurrentOptions(), text: qrContent };
    currentSvg = generateQRSvg(options);
    const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(currentSvg)))}`;
    preview.innerHTML = `<img src="${dataUrl}" alt="QR Code Preview">`;
    // Show encoded content below preview
    const encodedDisplay = document.getElementById('encodedContent');
    if (encodedDisplay) {
      encodedDisplay.textContent = qrContent;
      encodedDisplay.title = qrContent;
    }
    btnPaste.disabled = false;
    btnDownload.disabled = false;
    btnSave.disabled = false;
  } catch (e: any) {
    preview.innerHTML = `<div class="placeholder" style="color:var(--figma-color-text-danger);">Error: ${e.message}</div>`;
    const encodedDisplay = document.getElementById('encodedContent');
    if (encodedDisplay) encodedDisplay.textContent = '';
    btnPaste.disabled = true;
    btnDownload.disabled = true;
    btnSave.disabled = true;
    currentSvg = '';
  }
}

function debouncedPreview() {
  if (previewTimeout) clearTimeout(previewTimeout);
  previewTimeout = setTimeout(updatePreview, 200);
}

function resetCreateForm() {
  editingRecord = null;
  (getEl('inputUrl') as HTMLInputElement).value = '';
  (getEl('inputName') as HTMLInputElement).value = '';
  (getEl('inputCategory') as HTMLSelectElement).value = 'Website';
  (getEl('inputFolder') as HTMLInputElement).value = '';
  (getEl('colorFg') as HTMLInputElement).value = '#000000';
  (getEl('colorFgHex') as HTMLInputElement).value = '#000000';
  (getEl('colorBg') as HTMLInputElement).value = '#FFFFFF';
  (getEl('colorBgHex') as HTMLInputElement).value = '#FFFFFF';
  (getEl('inputEC') as HTMLSelectElement).value = 'M';
  (getEl('inputSize') as HTMLInputElement).value = '256';
  (getEl('inputMargin') as HTMLInputElement).value = '4';
  qrStyle = 'square';
  exportFormat = 'svg';
  sourceType = 'url';

  queryAll('.style-option').forEach(el => el.classList.toggle('active', (el as HTMLElement).dataset.style === 'square'));
  queryAll('.format-option').forEach(el => el.classList.toggle('active', (el as HTMLElement).dataset.format === 'svg'));
  getEl('srcUrl').classList.add('active');
  getEl('srcFrame').classList.remove('active');
  getEl('frameGroup').classList.add('hidden');
  getEl('createTitle').textContent = 'New QR Code';
  currentSvg = '';
  selectedFrame = null;
  renderDynamicFields('Website');
  getEl('dynamicFieldsTitle').textContent = CATEGORY_FIELDS['Website'].label;
  updatePreview();
}

function loadRecordIntoForm(record: QRCodeRecord) {
  editingRecord = record;
  (getEl('inputUrl') as HTMLInputElement).value = record.url;
  (getEl('inputName') as HTMLInputElement).value = record.name;
  (getEl('inputCategory') as HTMLSelectElement).value = record.category;
  (getEl('inputFolder') as HTMLInputElement).value = record.folder;
  (getEl('colorFg') as HTMLInputElement).value = record.customization.foreground;
  (getEl('colorFgHex') as HTMLInputElement).value = record.customization.foreground;
  (getEl('colorBg') as HTMLInputElement).value = record.customization.background;
  (getEl('colorBgHex') as HTMLInputElement).value = record.customization.background;
  (getEl('inputEC') as HTMLSelectElement).value = record.customization.errorCorrection;
  (getEl('inputSize') as HTMLInputElement).value = String(record.customization.size);
  (getEl('inputMargin') as HTMLInputElement).value = String(record.customization.margin);
  qrStyle = record.customization.style;
  sourceType = record.sourceType;

  queryAll('.style-option').forEach(el => el.classList.toggle('active', (el as HTMLElement).dataset.style === qrStyle));
  getEl('srcUrl').classList.toggle('active', sourceType === 'url');
  getEl('srcFrame').classList.toggle('active', sourceType === 'frame');
  getEl('frameGroup').classList.toggle('hidden', sourceType !== 'frame');
  getEl('createTitle').textContent = 'Edit QR Code';
  // Render dynamic fields for this category and populate URL field
  const cat = record.category as QRCategory;
  const config = CATEGORY_FIELDS[cat];
  if (config) {
    getEl('dynamicFieldsTitle').textContent = config.label;
    renderDynamicFields(cat);
  }
  // For URL-based types, populate the f-url field
  const fUrl = document.getElementById('f-url') as HTMLInputElement | null;
  if (fUrl && record.url) fUrl.value = record.url.replace(/^https?:\/\//, '');

  if (record.sourceType === 'frame' && record.frameId) {
    selectedFrame = { id: record.frameId, name: record.frameName || record.frameId };
    getEl('frameName').textContent = selectedFrame.name;
    getEl('frameSelector').classList.add('has-frame');
  }

  updatePreview();
}

// === Detail View ===
function showDetail(record: QRCodeRecord) {
  detailRecord = record;
  getEl('detailTitle').textContent = record.name;

  const info = getEl('detailInfo');
  info.innerHTML = `
    <div class="detail-stats">
      <div class="stat-card">
        <div class="stat-value">${record.scans}</div>
        <div class="stat-label">Total Scans</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--figma-color-text-success);">${record.status === 'active' ? 'Active' : 'Inactive'}</div>
        <div class="stat-label">Status</div>
      </div>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Name</div>
      <div class="detail-field-value">${record.name}</div>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">URL</div>
      <div class="detail-field-value" style="word-break:break-all;">${record.url}</div>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Category</div>
      <div class="detail-field-value">${record.category}</div>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Folder</div>
      <div class="detail-field-value">${record.folder || 'No folder'}</div>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Source</div>
      <div class="detail-field-value">${record.sourceType === 'frame' ? `Figma Frame: ${record.frameName || record.frameId}` : 'External URL'}</div>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Created</div>
      <div class="detail-field-value">${formatDate(record.createdAt)}</div>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Last Modified</div>
      <div class="detail-field-value">${formatDate(record.modifiedAt)}</div>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Customization</div>
      <div class="detail-field-value">
        Style: ${record.customization.style} | EC: ${record.customization.errorCorrection} | Size: ${record.customization.size}px
      </div>
    </div>
  `;

  const preview = getEl('detailPreview');
  const qrDataUrl = record.svgData
    ? `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(record.svgData)))}`
    : '';

  preview.innerHTML = `
    <div class="preview-qr">
      ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR">` : '<div class="placeholder">No preview</div>'}
    </div>
    <div class="preview-actions">
      <button class="btn btn-primary" id="detailPaste" ${record.svgData ? '' : 'disabled'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8m-4-4h8"/></svg>
        Paste into Figma
      </button>
      <button class="btn btn-secondary" id="detailDownload" ${record.svgData ? '' : 'disabled'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download
      </button>
    </div>
  `;

  const pasteBtn = getEl('detailPaste');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', () => {
      if (record.svgData) {
        postMsg({ type: 'insert-svg', svg: record.svgData, name: record.name });
      }
    });
  }
  const dlBtn = getEl('detailDownload');
  if (dlBtn) {
    dlBtn.addEventListener('click', () => downloadQR(record));
  }

  switchView('detail');
}

// === Download ===
function downloadQR(record: QRCodeRecord) {
  if (!record.svgData) return;
  const blob = new Blob([record.svgData], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${record.name.replace(/[^a-z0-9]/gi, '-')}.svg`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Downloaded!');
}

async function downloadCurrentQR() {
  if (!currentSvg) return;
  const name = (getEl('inputName') as HTMLInputElement).value || 'qr-code';
  const safeName = name.replace(/[^a-z0-9]/gi, '-');

  if (exportFormat === 'svg') {
    const blob = new Blob([currentSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  } else if (exportFormat === 'png') {
    const options = getCurrentOptions();
    const dataUrl = await generateQRPngDataUrl(options);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${safeName}.png`;
    a.click();
  } else if (exportFormat === 'embed') {
    const encoded = btoa(unescape(encodeURIComponent(currentSvg)));
    const embedCode = `<img src="data:image/svg+xml;base64,${encoded}" alt="${name}" width="${(getEl('inputSize') as HTMLInputElement).value}" height="${(getEl('inputSize') as HTMLInputElement).value}">`;
    navigator.clipboard.writeText(embedCode);
    showToast('Embed code copied to clipboard!');
    return;
  }
  showToast('Downloaded!');
}

// === Save ===
function saveQRCode() {
  const category = (getEl('inputCategory') as HTMLSelectElement).value as QRCategory;
  const url = sourceType === 'url'
    ? generateQRContent(category)
    : `figma://frame/${selectedFrame?.id || ''}`;

  if (!url) return;

  const now = new Date().toISOString();
  const record: QRCodeRecord = {
    id: editingRecord?.id || generateId(),
    name: (getEl('inputName') as HTMLInputElement).value.trim() || 'Untitled',
    url,
    category: (getEl('inputCategory') as HTMLSelectElement).value,
    folder: (getEl('inputFolder') as HTMLInputElement).value.trim(),
    createdAt: editingRecord?.createdAt || now,
    modifiedAt: now,
    scans: editingRecord?.scans || 0,
    status: editingRecord?.status || 'active',
    sourceType,
    frameId: selectedFrame?.id,
    frameName: selectedFrame?.name,
    customization: {
      foreground: (getEl('colorFgHex') as HTMLInputElement).value,
      background: (getEl('colorBgHex') as HTMLInputElement).value,
      errorCorrection: (getEl('inputEC') as HTMLSelectElement).value as ECLevel,
      size: parseInt((getEl('inputSize') as HTMLInputElement).value) || 256,
      margin: parseInt((getEl('inputMargin') as HTMLInputElement).value) || 4,
      style: qrStyle,
    },
    svgData: currentSvg,
  };

  postMsg({
    type: editingRecord ? 'update-record' : 'save-record',
    record,
  });

  switchView('dashboard');
  resetCreateForm();
}

// === Event Listeners ===
function initEvents() {
  // Create buttons
  getEl('btnCreate').addEventListener('click', () => {
    resetCreateForm();
    switchView('create');
  });
  getEl('btnCreateEmpty').addEventListener('click', () => {
    resetCreateForm();
    switchView('create');
  });

  // Back buttons
  getEl('tabBack').addEventListener('click', () => {
    switchView('dashboard');
    resetCreateForm();
  });
  getEl('tabDetailBack').addEventListener('click', () => {
    switchView('dashboard');
  });
  getEl('tabDetailEdit').addEventListener('click', () => {
    if (detailRecord) {
      loadRecordIntoForm(detailRecord);
      switchView('create');
    }
  });

  // Source toggle
  getEl('srcUrl').addEventListener('click', () => {
    sourceType = 'url';
    getEl('srcUrl').classList.add('active');
    getEl('srcFrame').classList.remove('active');
    getEl('frameGroup').classList.add('hidden');
    const cat = (getEl('inputCategory') as HTMLSelectElement).value as QRCategory;
    renderDynamicFields(cat);
    debouncedPreview();
  });
  getEl('srcFrame').addEventListener('click', () => {
    sourceType = 'frame';
    getEl('srcFrame').classList.add('active');
    getEl('srcUrl').classList.remove('active');
    getEl('frameGroup').classList.remove('hidden');
    postMsg({ type: 'get-selection' });
    debouncedPreview();
  });

  // Category/QR Type change → re-render fields
  getEl('inputCategory').addEventListener('change', () => {
    const cat = (getEl('inputCategory') as HTMLSelectElement).value as QRCategory;
    const config = CATEGORY_FIELDS[cat];
    if (config) {
      getEl('dynamicFieldsTitle').textContent = config.label;
      renderDynamicFields(cat);
    }
    debouncedPreview();
  });

  // Color pickers
  getEl('colorFg').addEventListener('input', (e) => {
    (getEl('colorFgHex') as HTMLInputElement).value = (e.target as HTMLInputElement).value;
    debouncedPreview();
  });
  getEl('colorFgHex').addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      (getEl('colorFg') as HTMLInputElement).value = val;
      debouncedPreview();
    }
  });
  getEl('colorBg').addEventListener('input', (e) => {
    (getEl('colorBgHex') as HTMLInputElement).value = (e.target as HTMLInputElement).value;
    debouncedPreview();
  });
  getEl('colorBgHex').addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      (getEl('colorBg') as HTMLInputElement).value = val;
      debouncedPreview();
    }
  });

  // Style buttons
  queryAll('.style-option').forEach(btn => {
    btn.addEventListener('click', () => {
      qrStyle = (btn as HTMLElement).dataset.style as QRStyle;
      queryAll('.style-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      debouncedPreview();
    });
  });

  // Format buttons
  queryAll('.format-option').forEach(btn => {
    btn.addEventListener('click', () => {
      exportFormat = (btn as HTMLElement).dataset.format as 'svg' | 'png' | 'embed';
      queryAll('.format-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // EC, size, margin
  getEl('inputEC').addEventListener('change', debouncedPreview);
  getEl('inputSize').addEventListener('input', debouncedPreview);
  getEl('inputMargin').addEventListener('input', debouncedPreview);

  // Preview action buttons
  getEl('btnPasteToFigma').addEventListener('click', () => {
    if (currentSvg) {
      const name = (getEl('inputName') as HTMLInputElement).value || 'QR Code';
      postMsg({ type: 'insert-svg', svg: currentSvg, name });
    }
  });
  getEl('btnDownload').addEventListener('click', downloadCurrentQR);
  getEl('btnSave').addEventListener('click', saveQRCode);

  // Filter events
  getEl('searchInput').addEventListener('input', renderDashboard);
  getEl('filterStatus').addEventListener('change', renderDashboard);
  getEl('filterCategory').addEventListener('change', renderDashboard);
  getEl('filterSort').addEventListener('change', renderDashboard);
  getEl('filterQuantity').addEventListener('change', renderDashboard);

  // Select all
  getEl('selectAll').addEventListener('click', () => {
    const filtered = getFilteredRecords();
    if (selectedIds.size === filtered.length) {
      selectedIds.clear();
    } else {
      filtered.forEach(r => selectedIds.add(r.id));
    }
    renderDashboard();
  });

  // Bulk actions
  getEl('btnBulkDelete').addEventListener('click', () => {
    if (selectedIds.size > 0) {
      postMsg({ type: 'delete-multiple', ids: Array.from(selectedIds) });
      selectedIds.clear();
    }
  });
  getEl('btnBulkExport').addEventListener('click', () => {
    const selected = records.filter(r => selectedIds.has(r.id));
    selected.forEach(r => downloadQR(r));
  });

  getEl('bulkCheckbox').addEventListener('click', () => {
    selectedIds.clear();
    renderDashboard();
  });

  // Delegate clicks on list items
  getEl('listContainer').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const actionEl = target.closest('[data-action]') as HTMLElement;
    if (!actionEl) return;

    const action = actionEl.dataset.action!;
    const id = actionEl.dataset.id!;

    switch (action) {
      case 'toggle': {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        renderDashboard();
        break;
      }
      case 'rename': {
        // Handled by blur/enter on the input
        break;
      }
      case 'show-qr': {
        const rec = records.find(r => r.id === id);
        if (rec?.svgData) {
          const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(rec.svgData)))}`;
          const imgEl = getEl('qrModalImg') as HTMLImageElement;
          imgEl.src = dataUrl;
          imgEl.style.opacity = rec.status === 'inactive' ? '0.15' : '1';
          imgEl.style.filter = rec.status === 'inactive' ? 'grayscale(1)' : 'none';
          getEl('qrModalName').textContent = rec.name;
          getEl('qrModalUrl').textContent = rec.status === 'inactive'
            ? 'This QR code is INACTIVE — do not distribute'
            : rec.url;
          getEl('qrModalUrl').style.color = rec.status === 'inactive' ? '#f24822' : '';
          getEl('qrModal').classList.add('open');
        }
        break;
      }
      case 'detail': {
        const rec = records.find(r => r.id === id);
        if (rec) showDetail(rec);
        break;
      }
      case 'download': {
        const rec = records.find(r => r.id === id);
        if (rec && rec.status === 'inactive') {
          showToast('Cannot download — QR is inactive');
        } else if (rec) {
          downloadQR(rec);
        }
        break;
      }
      case 'paste': {
        const rec = records.find(r => r.id === id);
        if (rec && rec.status === 'inactive') {
          showToast('Cannot paste — QR is inactive');
        } else if (rec?.svgData) {
          postMsg({ type: 'insert-svg', svg: rec.svgData, name: rec.name });
        }
        closeAllMenus();
        break;
      }
      case 'edit': {
        const rec = records.find(r => r.id === id);
        if (rec) {
          loadRecordIntoForm(rec);
          switchView('create');
        }
        closeAllMenus();
        break;
      }
      case 'toggle-status': {
        const rec = records.find(r => r.id === id);
        if (rec) {
          rec.status = rec.status === 'active' ? 'inactive' : 'active';
          rec.modifiedAt = new Date().toISOString();
          postMsg({ type: 'update-record', record: rec });
        }
        closeAllMenus();
        break;
      }
      case 'delete': {
        postMsg({ type: 'delete-record', id });
        closeAllMenus();
        break;
      }
      case 'menu': {
        e.stopPropagation();
        const menu = getEl(`menu-${id}`);
        const isOpen = menu.classList.contains('open');
        closeAllMenus();
        if (!isOpen) menu.classList.add('open');
        break;
      }
      case 'copy-url': {
        e.preventDefault();
        const url = actionEl.dataset.url || '';
        navigator.clipboard.writeText(url);
        showToast('URL copied!');
        break;
      }
    }
  });

  // Rename on blur/enter
  getEl('listContainer').addEventListener('blur', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains('qr-name-input')) {
      const id = target.dataset.id!;
      postMsg({ type: 'update-name', id, name: target.value.trim() });
    }
  }, true);

  getEl('listContainer').addEventListener('keydown', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains('qr-name-input') && (e as KeyboardEvent).key === 'Enter') {
      target.blur();
    }
  });

  // Close menus on outside click
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-action="menu"]')) {
      closeAllMenus();
    }
  });

  // QR Modal - close on overlay click
  getEl('qrModal').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'qrModal') {
      getEl('qrModal').classList.remove('open');
    }
  });
}

function closeAllMenus() {
  queryAll('.menu.open').forEach(m => m.classList.remove('open'));
}

// === Messages from plugin ===
window.onmessage = (event) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;

  switch (msg.type) {
    case 'records-loaded':
      records = msg.records || [];
      updateCategoryFilter();
      renderDashboard();
      break;

    case 'selection-data':
    case 'selection-changed':
      if (msg.frame) {
        selectedFrame = msg.frame;
        getEl('frameName').textContent = msg.frame.name;
        getEl('frameSelector').classList.add('has-frame');
      } else {
        selectedFrame = null;
        getEl('frameName').textContent = 'Select a frame in Figma canvas';
        getEl('frameSelector').classList.remove('has-frame');
      }
      if (currentView === 'create' && sourceType === 'frame') {
        debouncedPreview();
      }
      break;
  }
};

// === API Configuration ===
const API_BASE = ''; // Set after deploy, e.g. 'https://your-site.netlify.app'
const API_KEY = ''; // Set after deploy

async function fetchAnalytics(qrId: string | null, dateRange: string): Promise<any> {
  if (!API_BASE) {
    // Demo/offline mode - generate mock data
    return generateMockAnalytics();
  }
  const now = new Date();
  let from = '';
  if (dateRange === '7d') from = new Date(now.getTime() - 7 * 86400000).toISOString();
  else if (dateRange === '30d') from = new Date(now.getTime() - 30 * 86400000).toISOString();
  else if (dateRange === '90d') from = new Date(now.getTime() - 90 * 86400000).toISOString();

  const endpoint = qrId && qrId !== 'all' ? `/api/analytics/${qrId}` : '/api/analytics';
  const params = from ? `?from=${from}` : '';

  const res = await fetch(`${API_BASE}${endpoint}${params}`, {
    headers: { 'X-API-Key': API_KEY },
  });
  return res.json();
}

function generateMockAnalytics() {
  const total = records.reduce((sum, r) => sum + r.scans, 0);
  const now = new Date();
  // Generate realistic daily scan data for last 30 days
  const scansByDay = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now.getTime() - (29 - i) * 86400000);
    return { date: d.toISOString().split('T')[0], count: total > 0 ? Math.floor(Math.random() * (total / 8) + total / 20) : 0 };
  });
  const scansByHour = Array.from({ length: 24 }, (_, i) => ({
    hour: i, count: total > 0 ? Math.floor(Math.random() * (total / 12) * (i >= 8 && i <= 20 ? 2 : 0.5)) : 0
  }));
  const dows = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const scansByDayOfWeek = dows.map(d => ({ day: d, count: total > 0 ? Math.floor(Math.random() * (total / 5)) : 0 }));
  const mockCountries = [
    { name: 'United Kingdom', count: Math.round(total * 0.35) },
    { name: 'United States', count: Math.round(total * 0.20) },
    { name: 'Spain', count: Math.round(total * 0.12) },
    { name: 'Germany', count: Math.round(total * 0.08) },
    { name: 'France', count: Math.round(total * 0.06) },
    { name: 'Brazil', count: Math.round(total * 0.05) },
    { name: 'India', count: Math.round(total * 0.04) },
    { name: 'Australia', count: Math.round(total * 0.03) },
  ].filter(c => c.count > 0);
  const mockLocations = [
    { lat: 51.5, lng: -0.12, city: 'London', country: 'United Kingdom', count: Math.round(total * 0.18) },
    { lat: 40.71, lng: -74.0, city: 'New York', country: 'United States', count: Math.round(total * 0.10) },
    { lat: 53.48, lng: -2.24, city: 'Manchester', country: 'United Kingdom', count: Math.round(total * 0.09) },
    { lat: 40.42, lng: -3.70, city: 'Madrid', country: 'Spain', count: Math.round(total * 0.07) },
    { lat: 48.86, lng: 2.35, city: 'Paris', country: 'France', count: Math.round(total * 0.05) },
    { lat: -23.55, lng: -46.63, city: 'São Paulo', country: 'Brazil', count: Math.round(total * 0.04) },
  ].filter(l => l.count > 0);
  return {
    totalScans: total,
    uniqueCountries: mockCountries.length,
    uniqueCities: mockLocations.length,
    uniqueVisitors: Math.round(total * 0.72),
    avgScansPerDay: total > 0 ? Math.round((total / 30) * 10) / 10 : 0,
    trendPercent: total > 0 ? Math.round(Math.random() * 40 - 10) : 0,
    peakHour: { hour: 14, count: Math.round(total * 0.12) },
    peakDay: scansByDay.length > 0 ? scansByDay.reduce((a, b) => a.count > b.count ? a : b) : { date: '', count: 0 },
    deviceSplit: { mobile: 62, desktop: 28, tablet: 10 },
    scanVelocity: {
      last24h: Math.round(total * 0.08),
      last7d: Math.round(total * 0.35),
      last30d: total,
    },
    topCountries: mockCountries,
    topCities: mockLocations.map(l => ({ name: `${l.city}, ${l.country}`, count: l.count })),
    topDevices: [
      { name: 'mobile', count: Math.round(total * 0.62) },
      { name: 'desktop', count: Math.round(total * 0.28) },
      { name: 'tablet', count: Math.round(total * 0.10) },
    ].filter(d => d.count > 0),
    topBrowsers: [
      { name: 'Chrome', count: Math.round(total * 0.45) },
      { name: 'Safari', count: Math.round(total * 0.28) },
      { name: 'Firefox', count: Math.round(total * 0.12) },
      { name: 'Edge', count: Math.round(total * 0.08) },
      { name: 'Samsung Internet', count: Math.round(total * 0.04) },
    ].filter(b => b.count > 0),
    topOS: [
      { name: 'iOS', count: Math.round(total * 0.38) },
      { name: 'Android', count: Math.round(total * 0.30) },
      { name: 'Windows', count: Math.round(total * 0.18) },
      { name: 'macOS', count: Math.round(total * 0.10) },
      { name: 'Linux', count: Math.round(total * 0.04) },
    ].filter(o => o.count > 0),
    topReferers: [
      { name: 'direct', count: Math.round(total * 0.45) },
      { name: 'instagram.com', count: Math.round(total * 0.18) },
      { name: 'google.com', count: Math.round(total * 0.15) },
      { name: 'twitter.com', count: Math.round(total * 0.10) },
    ].filter(r => r.count > 0),
    topLanguages: [
      { name: 'en', count: Math.round(total * 0.55) },
      { name: 'es', count: Math.round(total * 0.15) },
      { name: 'de', count: Math.round(total * 0.10) },
      { name: 'fr', count: Math.round(total * 0.08) },
      { name: 'pt', count: Math.round(total * 0.06) },
    ].filter(l => l.count > 0),
    refererCategories: [
      { name: 'Direct', count: Math.round(total * 0.45) },
      { name: 'Social Media', count: Math.round(total * 0.28) },
      { name: 'Search Engine', count: Math.round(total * 0.15) },
      { name: 'Other', count: Math.round(total * 0.12) },
    ].filter(r => r.count > 0),
    topQRCodes: records.slice(0, 5).map((r, i) => ({ id: r.id, name: r.name, scans: Math.max(r.scans, Math.round(total / (i + 2))), url: r.url })),
    scansByDay,
    scansByHour,
    scansByDayOfWeek,
    recentScans: [],
    scanLocations: mockLocations,
  };
}

// === Chart Drawing Helpers ===
const CHART_COLORS = ['#0d99ff', '#14ae5c', '#f24822', '#a050ff', '#ffb400', '#ff6b6b', '#00c2b8', '#ff8f3f'];

function countryToEmoji(country: string): string {
  const map: Record<string, string> = {
    'United Kingdom': '\uD83C\uDDEC\uD83C\uDDE7', 'United States': '\uD83C\uDDFA\uD83C\uDDF8', 'Spain': '\uD83C\uDDEA\uD83C\uDDF8',
    'Germany': '\uD83C\uDDE9\uD83C\uDDEA', 'France': '\uD83C\uDDEB\uD83C\uDDF7', 'Brazil': '\uD83C\uDDE7\uD83C\uDDF7',
    'India': '\uD83C\uDDEE\uD83C\uDDF3', 'Australia': '\uD83C\uDDE6\uD83C\uDDFA', 'Canada': '\uD83C\uDDE8\uD83C\uDDE6',
    'Japan': '\uD83C\uDDEF\uD83C\uDDF5', 'China': '\uD83C\uDDE8\uD83C\uDDF3', 'Italy': '\uD83C\uDDEE\uD83C\uDDF9',
    'Mexico': '\uD83C\uDDF2\uD83C\uDDFD', 'Netherlands': '\uD83C\uDDF3\uD83C\uDDF1', 'Portugal': '\uD83C\uDDF5\uD83C\uDDF9',
    'Argentina': '\uD83C\uDDE6\uD83C\uDDF7', 'Sweden': '\uD83C\uDDF8\uD83C\uDDEA', 'Poland': '\uD83C\uDDF5\uD83C\uDDF1',
    'Ireland': '\uD83C\uDDEE\uD83C\uDDEA', 'South Korea': '\uD83C\uDDF0\uD83C\uDDF7',
  };
  return map[country] || '\uD83C\uDF10';
}

function setupCanvas(canvasId: string, w: number, h: number): { ctx: CanvasRenderingContext2D; cw: number; ch: number } | null {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  return { ctx, cw: w, ch: h };
}

function drawLineChart(canvasId: string, data: { date: string; count: number }[]) {
  if (!data || data.length === 0) return;
  const setup = setupCanvas(canvasId, 520, 120);
  if (!setup) return;
  const { ctx, cw, ch } = setup;
  const pad = { top: 10, right: 10, bottom: 20, left: 35 };
  const w = cw - pad.left - pad.right;
  const h = ch - pad.top - pad.bottom;
  const max = Math.max(...data.map(d => d.count), 1);

  // Y-axis labels
  ctx.font = '9px Inter, sans-serif';
  ctx.fillStyle = '#999';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + h - (i / 4) * h;
    const val = Math.round((i / 4) * max);
    ctx.fillText(val.toString(), pad.left - 6, y + 3);
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(cw - pad.right, y);
    ctx.stroke();
  }

  // Line + gradient
  const points = data.map((d, i) => ({
    x: pad.left + (i / (data.length - 1)) * w,
    y: pad.top + h - (d.count / max) * h,
  }));

  // Gradient fill
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
  grad.addColorStop(0, 'rgba(13, 153, 255, 0.2)');
  grad.addColorStop(1, 'rgba(13, 153, 255, 0)');
  ctx.beginPath();
  ctx.moveTo(points[0].x, pad.top + h);
  ctx.lineTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const cx1 = (points[i - 1].x + points[i].x) / 2;
    ctx.bezierCurveTo(cx1, points[i - 1].y, cx1, points[i].y, points[i].x, points[i].y);
  }
  ctx.lineTo(points[points.length - 1].x, pad.top + h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const cx1 = (points[i - 1].x + points[i].x) / 2;
    ctx.bezierCurveTo(cx1, points[i - 1].y, cx1, points[i].y, points[i].x, points[i].y);
  }
  ctx.strokeStyle = '#0d99ff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dots
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#0d99ff';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // X-axis labels
  ctx.fillStyle = '#999';
  ctx.textAlign = 'center';
  ctx.font = '8px Inter, sans-serif';
  const step = Math.max(1, Math.floor(data.length / 6));
  for (let i = 0; i < data.length; i += step) {
    ctx.fillText(data[i].date.slice(5), points[i].x, ch - 4);
  }
}

function drawDonutChart(canvasId: string, segments: { name: string; count: number }[]) {
  if (!segments || segments.length === 0) return;
  const setup = setupCanvas(canvasId, 110, 110);
  if (!setup) return;
  const { ctx } = setup;
  const cx = 55, cy = 55, r = 42, lineW = 14;
  const total = segments.reduce((s, d) => s + d.count, 0) || 1;
  let startAngle = -Math.PI / 2;

  segments.forEach((seg, i) => {
    const sweep = (seg.count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + sweep);
    ctx.strokeStyle = CHART_COLORS[i % CHART_COLORS.length];
    ctx.lineWidth = lineW;
    ctx.lineCap = 'butt';
    ctx.stroke();
    startAngle += sweep;
  });

  // Center text
  ctx.fillStyle = '#333';
  ctx.font = 'bold 16px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total.toLocaleString(), cx, cy - 4);
  ctx.fillStyle = '#999';
  ctx.font = '8px Inter, sans-serif';
  ctx.fillText('total', cx, cy + 10);
}

function drawBarChart(canvasId: string, items: { label: string; value: number }[], color = '#0d99ff') {
  if (!items || items.length === 0) return;
  const setup = setupCanvas(canvasId, 250, 90);
  if (!setup) return;
  const { ctx, cw, ch } = setup;
  const pad = { top: 5, right: 5, bottom: 18, left: 5 };
  const w = cw - pad.left - pad.right;
  const h = ch - pad.top - pad.bottom;
  const max = Math.max(...items.map(d => d.value), 1);
  const barW = w / items.length;
  const gap = Math.max(1, barW * 0.2);

  items.forEach((item, i) => {
    const x = pad.left + i * barW + gap / 2;
    const bw = barW - gap;
    const bh = (item.value / max) * h;
    const y = pad.top + h - bh;

    ctx.fillStyle = item.value > 0 ? color : 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, [2, 2, 0, 0]);
    ctx.fill();

    ctx.fillStyle = '#999';
    ctx.font = '8px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(item.label, x + bw / 2, ch - 4);
  });
}

// Table pagination state
let analyticsTablePage = 0;
let analyticsTableData: any[] = [];
const TABLE_PAGE_SIZE = 10;

function setupTablePagination(scans: any[]) {
  analyticsTableData = scans;
  analyticsTablePage = 0;
  renderTablePage();

  // Wire up buttons
  const prevBtn = document.getElementById('tablePrev');
  const nextBtn = document.getElementById('tableNext');
  if (prevBtn) prevBtn.onclick = () => { if (analyticsTablePage > 0) { analyticsTablePage--; renderTablePage(); } };
  if (nextBtn) nextBtn.onclick = () => {
    if ((analyticsTablePage + 1) * TABLE_PAGE_SIZE < analyticsTableData.length) { analyticsTablePage++; renderTablePage(); }
  };
}

function renderTablePage() {
  const tbody = document.getElementById('scansTableBody');
  const pageInfo = document.getElementById('tablePageInfo');
  const prevBtn = document.getElementById('tablePrev') as HTMLButtonElement;
  const nextBtn = document.getElementById('tableNext') as HTMLButtonElement;
  if (!tbody) return;

  const start = analyticsTablePage * TABLE_PAGE_SIZE;
  const page = analyticsTableData.slice(start, start + TABLE_PAGE_SIZE);
  const totalPages = Math.ceil(analyticsTableData.length / TABLE_PAGE_SIZE) || 1;

  tbody.innerHTML = page.map((s: any) => {
    const d = new Date(s.timestamp);
    const time = `${d.toLocaleDateString('en', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}`;
    return `<tr>
      <td>${time}</td>
      <td>${s.city !== 'Unknown' ? `${s.city}, ${s.country}` : s.country}</td>
      <td>${s.deviceType || 'desktop'}</td>
      <td>${s.browser}</td>
      <td>${s.os}</td>
    </tr>`;
  }).join('');

  if (pageInfo) pageInfo.textContent = `Page ${analyticsTablePage + 1} of ${totalPages}`;
  if (prevBtn) prevBtn.disabled = analyticsTablePage === 0;
  if (nextBtn) nextBtn.disabled = (analyticsTablePage + 1) * TABLE_PAGE_SIZE >= analyticsTableData.length;
}

// Simplified world map SVG (continent outlines)
const WORLD_SVG = `<svg viewBox="0 0 1000 500" xmlns="http://www.w3.org/2000/svg">
  <path class="land" d="M165,55 L175,45 200,42 230,48 255,42 272,50 280,68 295,72 300,85 295,105 278,120 268,145 255,162 242,168 225,175 210,192 195,205 178,208 162,198 148,195 135,188 125,175 115,162 108,148 112,128 118,110 130,95 145,80 158,68Z"/>
  <path class="land" d="M218,215 L235,212 248,218 258,232 268,248 272,268 275,290 272,312 265,335 258,355 248,372 238,388 225,398 212,402 202,395 195,378 192,358 195,338 198,315 202,295 205,272 208,252 212,235Z"/>
  <path class="land" d="M432,52 L445,48 458,50 475,48 490,52 502,58 508,68 515,78 520,92 518,108 510,118 498,128 488,135 475,138 460,135 448,128 438,118 432,108 428,95 425,82 428,68Z"/>
  <path class="land" d="M435,148 L452,142 470,145 488,148 502,155 512,168 518,185 522,205 520,225 515,248 508,268 498,288 488,308 475,325 462,338 448,348 438,355 428,348 422,335 418,318 415,298 418,275 422,255 428,235 432,215 435,195 435,175Z"/>
  <path class="land" d="M538,38 L568,32 600,28 635,32 668,28 700,32 732,38 758,48 778,62 792,78 802,98 808,118 805,142 798,162 785,178 768,192 748,202 725,208 700,205 675,198 652,188 632,178 615,168 598,155 582,142 568,128 555,112 545,95 540,78 535,62Z"/>
  <path class="land" d="M768,288 L788,278 812,275 838,278 862,285 878,298 888,315 892,335 888,355 878,372 862,385 842,392 818,388 798,378 782,365 772,348 768,328 765,308Z"/>
  <path class="land" d="M808,298 L828,290 852,292 872,300 885,315 892,332 888,352 878,368 862,378 842,382 822,375 808,362 798,345 795,325 798,310Z"/>
</svg>`;

function renderAnalytics(data: any) {
  const container = getEl('analyticsContent');

  if (data.totalScans === 0 && !API_BASE) {
    container.innerHTML = `
      <div class="analytics-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:40px;height:40px;margin-bottom:8px;color:var(--figma-color-bg-tertiary);"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
        <h3 style="font-size:13px;font-weight:600;margin-bottom:4px;">Connect Backend for Analytics</h3>
        <p style="font-size:11px;max-width:280px;margin:0 auto;">Deploy the backend to Netlify and set the API_BASE URL to enable real-time scan tracking with device, location, and time analytics.</p>
        <p style="font-size:10px;margin-top:8px;color:var(--figma-color-text-brand);">cd backend && netlify deploy --prod</p>
      </div>`;
    return;
  }

  const trend = data.trendPercent || 0;
  const trendClass = trend > 0 ? 'up' : trend < 0 ? 'down' : 'neutral';
  const trendArrow = trend > 0 ? '\u2191' : trend < 0 ? '\u2193' : '\u2192';

  let html = '';

  // === A) KPI Cards ===
  html += `<div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-value">${(data.totalScans || 0).toLocaleString()}</div>
      <div class="kpi-label">Total Scans</div>
      <div class="kpi-trend ${trendClass}">${trendArrow} ${Math.abs(trend)}%</div>
      <canvas class="kpi-sparkline" id="sparklineScans"></canvas>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${(data.uniqueVisitors || 0).toLocaleString()}</div>
      <div class="kpi-label">Unique Visitors</div>
      <div class="kpi-trend neutral">${data.totalScans > 0 ? Math.round((data.uniqueVisitors / data.totalScans) * 100) : 0}% unique</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${data.uniqueCountries || 0}</div>
      <div class="kpi-label">Countries</div>
      <div class="kpi-trend neutral">${data.uniqueCities || 0} cities</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${data.avgScansPerDay || 0}</div>
      <div class="kpi-label">Avg / Day</div>
      <div class="kpi-trend neutral">Peak: ${data.peakHour?.hour ?? 0}:00</div>
    </div>
  </div>`;

  // === B) Velocity Bar ===
  if (data.scanVelocity) {
    html += `<div class="velocity-bar">
      <div class="velocity-item">
        <div class="velocity-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <div class="velocity-info">
          <div class="velocity-value">${data.scanVelocity.last24h}</div>
          <div class="velocity-label">Last 24h</div>
        </div>
      </div>
      <div class="velocity-item">
        <div class="velocity-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg></div>
        <div class="velocity-info">
          <div class="velocity-value">${data.scanVelocity.last7d}</div>
          <div class="velocity-label">Last 7 days</div>
        </div>
      </div>
      <div class="velocity-item">
        <div class="velocity-icon purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg></div>
        <div class="velocity-info">
          <div class="velocity-value">${data.scanVelocity.last30d}</div>
          <div class="velocity-label">Last 30 days</div>
        </div>
      </div>
    </div>`;
  }

  // === C) Scans Over Time - Canvas Line Chart ===
  if (data.scansByDay && data.scansByDay.length > 0) {
    html += `<div class="chart-card">
      <div class="chart-card-header">
        <div>
          <div class="chart-card-title">Scans Over Time</div>
          <div class="chart-card-subtitle">${data.scansByDay.length} days \u2022 ${data.totalScans.toLocaleString()} total</div>
        </div>
      </div>
      <div class="chart-card-body">
        <canvas id="scanLineChart" style="width:100%;height:120px;"></canvas>
      </div>
    </div>`;
  }

  // === D) Device Donut + Top Countries (2-col) ===
  html += `<div class="analytics-grid-2">`;

  // Device Donut
  if (data.topDevices && data.topDevices.length > 0) {
    const devTotal = data.topDevices.reduce((s: number, d: any) => s + d.count, 0) || 1;
    html += `<div class="chart-card">
      <div class="chart-card-header"><div class="chart-card-title">Devices</div></div>
      <div class="chart-card-body">
        <div class="donut-wrap">
          <div class="donut-chart"><canvas id="deviceDonut" width="110" height="110"></canvas></div>
          <div class="donut-legend">
            ${data.topDevices.map((d: any, i: number) => `
              <div class="donut-legend-item">
                <div class="donut-legend-color" style="background:${CHART_COLORS[i]}"></div>
                <div class="donut-legend-label">${d.name}</div>
                <div class="donut-legend-value">${d.count.toLocaleString()}</div>
                <div class="donut-legend-percent">${Math.round((d.count / devTotal) * 100)}%</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }

  // Top Countries
  if (data.topCountries && data.topCountries.length > 0) {
    const maxC = data.topCountries[0]?.count || 1;
    html += `<div class="chart-card">
      <div class="chart-card-header"><div class="chart-card-title">Top Countries</div></div>
      <div class="chart-card-body">
        <div class="bar-list">
          ${data.topCountries.slice(0, 8).map((c: any) => `
            <div class="bar-item">
              <div class="bar-item-label">${countryToEmoji(c.name)} ${c.name}</div>
              <div class="bar-item-bar"><div class="bar-item-fill" style="width:${(c.count / maxC) * 100}%;"></div></div>
              <div class="bar-item-count">${c.count}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;
  }
  html += `</div>`;

  // === E) Browsers + OS (2-col) ===
  if ((data.topBrowsers?.length > 0) || (data.topOS?.length > 0)) {
    html += `<div class="analytics-grid-2">`;
    if (data.topBrowsers?.length > 0) {
      const maxB = data.topBrowsers[0].count;
      html += `<div class="chart-card">
        <div class="chart-card-header"><div class="chart-card-title">Browsers</div></div>
        <div class="chart-card-body"><div class="bar-list">
          ${data.topBrowsers.slice(0, 6).map((b: any) => `
            <div class="bar-item"><div class="bar-item-label">${b.name}</div><div class="bar-item-bar"><div class="bar-item-fill" style="width:${(b.count / maxB) * 100}%;"></div></div><div class="bar-item-count">${b.count}</div></div>
          `).join('')}
        </div></div></div>`;
    }
    if (data.topOS?.length > 0) {
      const maxO = data.topOS[0].count;
      html += `<div class="chart-card">
        <div class="chart-card-header"><div class="chart-card-title">Operating Systems</div></div>
        <div class="chart-card-body"><div class="bar-list">
          ${data.topOS.slice(0, 6).map((o: any) => `
            <div class="bar-item"><div class="bar-item-label">${o.name}</div><div class="bar-item-bar"><div class="bar-item-fill" style="width:${(o.count / maxO) * 100}%;"></div></div><div class="bar-item-count">${o.count}</div></div>
          `).join('')}
        </div></div></div>`;
    }
    html += `</div>`;
  }

  // === F) Languages + Referer Sources (2-col) ===
  html += `<div class="analytics-grid-2">`;
  if (data.topLanguages?.length > 0) {
    const maxL = data.topLanguages[0].count;
    html += `<div class="chart-card">
      <div class="chart-card-header"><div class="chart-card-title">Languages</div></div>
      <div class="chart-card-body"><div class="bar-list">
        ${data.topLanguages.slice(0, 6).map((l: any) => `
          <div class="bar-item"><div class="bar-item-label">${l.name}</div><div class="bar-item-bar"><div class="bar-item-fill" style="width:${(l.count / maxL) * 100}%;"></div></div><div class="bar-item-count">${l.count}</div></div>
        `).join('')}
      </div></div></div>`;
  }
  if (data.refererCategories?.length > 0) {
    const refTotal = data.refererCategories.reduce((s: number, r: any) => s + r.count, 0) || 1;
    html += `<div class="chart-card">
      <div class="chart-card-header"><div class="chart-card-title">Traffic Sources</div></div>
      <div class="chart-card-body">
        <div class="donut-wrap">
          <div class="donut-chart"><canvas id="refererDonut" width="110" height="110"></canvas></div>
          <div class="donut-legend">
            ${data.refererCategories.map((r: any, i: number) => `
              <div class="donut-legend-item">
                <div class="donut-legend-color" style="background:${CHART_COLORS[i]}"></div>
                <div class="donut-legend-label">${r.name}</div>
                <div class="donut-legend-value">${r.count}</div>
                <div class="donut-legend-percent">${Math.round((r.count / refTotal) * 100)}%</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }
  html += `</div>`;

  // === G) Hour + Day of Week Canvas Charts (2-col) ===
  html += `<div class="analytics-grid-2">`;
  if (data.scansByHour) {
    html += `<div class="chart-card">
      <div class="chart-card-header">
        <div class="chart-card-title">Scans by Hour</div>
        <div class="chart-card-subtitle">UTC</div>
      </div>
      <div class="chart-card-body"><canvas id="hourChart" style="width:100%;height:90px;"></canvas></div>
    </div>`;
  }
  if (data.scansByDayOfWeek) {
    html += `<div class="chart-card">
      <div class="chart-card-header"><div class="chart-card-title">Scans by Day</div></div>
      <div class="chart-card-body"><canvas id="dowChart" style="width:100%;height:90px;"></canvas></div>
    </div>`;
  }
  html += `</div>`;

  // === H) Top QR Codes Leaderboard ===
  if (data.topQRCodes?.length > 0) {
    const maxQr = data.topQRCodes[0]?.scans || 1;
    const rankClass = (i: number) => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'normal';
    html += `<div class="chart-card">
      <div class="chart-card-header"><div class="chart-card-title">Top QR Codes</div></div>
      <div class="chart-card-body">
        <div class="leaderboard">
          ${data.topQRCodes.slice(0, 8).map((q: any, i: number) => `
            <div class="leaderboard-item">
              <div class="leaderboard-rank ${rankClass(i)}">${i + 1}</div>
              <div class="leaderboard-info">
                <div class="leaderboard-name">${q.name}</div>
                <div class="leaderboard-url">${q.url ? truncateUrl(q.url, 40) : ''}</div>
                <div class="leaderboard-bar"><div class="leaderboard-bar-fill" style="width:${(q.scans / maxQr) * 100}%;"></div></div>
              </div>
              <div class="leaderboard-scans">${q.scans.toLocaleString()}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;
  }

  // === I) World Map ===
  if (data.scanLocations && data.scanLocations.length > 0) {
    html += `<div class="map-card">
      <div class="map-header">
        <div class="map-header-title">Scan Locations</div>
        <span style="font-size:10px;color:var(--figma-color-text-secondary);">${data.scanLocations.length} locations</span>
      </div>
      <div class="map-container" id="worldMapContainer">
        ${WORLD_SVG}
        ${data.scanLocations.map((loc: any) => {
          const x = ((loc.lng + 180) / 360) * 100;
          const y = ((90 - loc.lat) / 180) * 100;
          const size = Math.min(12, 6 + loc.count);
          return `<div class="map-pin" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;" title="${loc.city}, ${loc.country}: ${loc.count} scans"></div>`;
        }).join('')}
      </div>
      <div class="map-legend">
        <span><span class="map-legend-dot" style="background:#f24822;"></span> Scan location</span>
        <span>Top: ${data.scanLocations[0]?.city}, ${data.scanLocations[0]?.country} (${data.scanLocations[0]?.count})</span>
      </div>
    </div>`;
  }

  // === J) Top Cities ===
  if (data.topCities?.length > 0) {
    const maxCity = data.topCities[0].count;
    html += `<div class="chart-card">
      <div class="chart-card-header"><div class="chart-card-title">Top Cities</div></div>
      <div class="chart-card-body"><div class="bar-list">
        ${data.topCities.slice(0, 10).map((c: any) => `
          <div class="bar-item"><div class="bar-item-label">${c.name}</div><div class="bar-item-bar"><div class="bar-item-fill" style="width:${(c.count / maxCity) * 100}%;"></div></div><div class="bar-item-count">${c.count}</div></div>
        `).join('')}
      </div></div>
    </div>`;
  }

  // === K) Recent Scans Table with Pagination ===
  if (data.recentScans?.length > 0) {
    html += `<div class="data-table-card">
      <div class="data-table-header">
        <div class="data-table-title">Recent Scans</div>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>Time</th><th>Location</th><th>Device</th><th>Browser</th><th>OS</th>
        </tr></thead>
        <tbody id="scansTableBody"></tbody>
      </table>
      <div class="data-table-footer">
        <span id="tablePageInfo">Page 1 of 1</span>
        <div class="data-table-pagination">
          <button type="button" id="tablePrev" disabled>\u2190 Prev</button>
          <button type="button" id="tableNext">Next \u2192</button>
        </div>
      </div>
    </div>`;
  }

  container.innerHTML = html;

  // === Draw Canvas Charts ===
  setTimeout(() => {
    drawLineChart('scanLineChart', data.scansByDay || []);
    drawDonutChart('deviceDonut', data.topDevices || []);
    drawDonutChart('refererDonut', data.refererCategories || []);
    drawBarChart('hourChart', (data.scansByHour || []).map((h: any) => ({ label: h.hour + 'h', value: h.count })));
    drawBarChart('dowChart', (data.scansByDayOfWeek || []).map((d: any) => ({ label: d.day.slice(0, 2), value: d.count })), '#14ae5c');

    // Sparkline for KPI
    const sparkSetup = setupCanvas('sparklineScans', 80, 32);
    if (sparkSetup && data.scansByDay?.length > 0) {
      const { ctx, cw, ch } = sparkSetup;
      const vals = data.scansByDay.map((d: any) => d.count);
      const max = Math.max(...vals, 1);
      const grad = ctx.createLinearGradient(0, 0, 0, ch);
      grad.addColorStop(0, 'rgba(13,153,255,0.4)');
      grad.addColorStop(1, 'rgba(13,153,255,0)');
      ctx.beginPath();
      ctx.moveTo(0, ch);
      vals.forEach((v: number, i: number) => {
        ctx.lineTo((i / (vals.length - 1)) * cw, ch - (v / max) * ch);
      });
      ctx.lineTo(cw, ch);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      vals.forEach((v: number, i: number) => {
        const x = (i / (vals.length - 1)) * cw;
        const y = ch - (v / max) * ch;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#0d99ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Table pagination
    if (data.recentScans?.length > 0) {
      setupTablePagination(data.recentScans);
    }
  }, 0);
}

async function loadAnalytics() {
  const qrFilter = (getEl('analyticsQrFilter') as HTMLSelectElement).value;
  const dateRange = (getEl('analyticsDateRange') as HTMLSelectElement).value;

  getEl('analyticsContent').innerHTML = '<div class="analytics-empty"><p>Loading analytics...</p></div>';

  try {
    const data = await fetchAnalytics(qrFilter === 'all' ? null : qrFilter, dateRange);
    renderAnalytics(data);
  } catch (e: any) {
    getEl('analyticsContent').innerHTML = `<div class="analytics-empty"><p style="color:var(--figma-color-text-danger);">Failed to load analytics: ${e.message}</p></div>`;
  }
}

function populateAnalyticsQrFilter() {
  const select = getEl('analyticsQrFilter') as HTMLSelectElement;
  const current = select.value;
  select.innerHTML = '<option value="all">All QR Codes</option>';
  records.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    select.appendChild(opt);
  });
  select.value = current;
}

// === Init ===
initEvents();

// Analytics button
getEl('btnAnalytics').addEventListener('click', () => {
  populateAnalyticsQrFilter();
  switchView('analytics');
  loadAnalytics();
});
getEl('tabAnalyticsBack').addEventListener('click', () => switchView('dashboard'));
getEl('analyticsQrFilter').addEventListener('change', loadAnalytics);
getEl('analyticsDateRange').addEventListener('change', loadAnalytics);

postMsg({ type: 'load-records' });
