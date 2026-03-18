/// <reference types="@figma/plugin-typings" />

import type { QRCodeRecord, PluginMessage } from './types';

const STORAGE_KEY = 'qrcode-studio-records';

figma.showUI(__html__, {
  width: 840,
  height: 580,
  themeColors: true,
  title: 'QR Code Studio',
});

// --- Storage helpers ---

async function loadRecords(): Promise<QRCodeRecord[]> {
  const data = await figma.clientStorage.getAsync(STORAGE_KEY);
  return Array.isArray(data) ? data : [];
}

async function saveRecords(records: QRCodeRecord[]): Promise<void> {
  await figma.clientStorage.setAsync(STORAGE_KEY, records);
}

async function addRecord(record: QRCodeRecord): Promise<void> {
  const records = await loadRecords();
  records.unshift(record);
  await saveRecords(records);
}

async function updateRecord(updated: QRCodeRecord): Promise<void> {
  const records = await loadRecords();
  const idx = records.findIndex(r => r.id === updated.id);
  if (idx !== -1) {
    records[idx] = updated;
    await saveRecords(records);
  }
}

async function deleteRecord(id: string): Promise<void> {
  const records = await loadRecords();
  await saveRecords(records.filter(r => r.id !== id));
}

async function deleteMultipleRecords(ids: string[]): Promise<void> {
  const records = await loadRecords();
  await saveRecords(records.filter(r => !ids.includes(r.id)));
}

// --- Figma insertion helpers ---

function insertSvgIntoFigma(svgString: string, name: string): void {
  const node = figma.createNodeFromSvg(svgString);
  node.name = `QR: ${name}`;

  // Center in viewport
  const { x, y } = figma.viewport.center;
  node.x = x - node.width / 2;
  node.y = y - node.height / 2;

  figma.currentPage.appendChild(node);
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}

async function getSelectedFrameData(): Promise<{ id: string; name: string } | null> {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) return null;
  const node = selection[0];
  if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'GROUP') {
    return { id: node.id, name: node.name };
  }
  return null;
}

async function exportFrameAsDataUrl(frameId: string): Promise<string | null> {
  const node = figma.getNodeById(frameId);
  if (!node || !('exportAsync' in node)) return null;
  try {
    const bytes = await (node as FrameNode).exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
    const base64 = figma.base64Encode(bytes);
    return `data:image/png;base64,${base64}`;
  } catch (_e) {
    return null;
  }
}

// --- Message handler ---

figma.ui.onmessage = async (msg: PluginMessage) => {
  switch (msg.type) {
    case 'load-records': {
      const records = await loadRecords();
      figma.ui.postMessage({ type: 'records-loaded', records });
      break;
    }

    case 'save-record': {
      const record: QRCodeRecord = msg.record;
      await addRecord(record);
      const records = await loadRecords();
      figma.ui.postMessage({ type: 'records-loaded', records });
      figma.notify(`QR code "${record.name}" saved`);
      break;
    }

    case 'update-record': {
      const record: QRCodeRecord = msg.record;
      await updateRecord(record);
      const records = await loadRecords();
      figma.ui.postMessage({ type: 'records-loaded', records });
      figma.notify(`QR code "${record.name}" updated`);
      break;
    }

    case 'delete-record': {
      await deleteRecord(msg.id);
      const records = await loadRecords();
      figma.ui.postMessage({ type: 'records-loaded', records });
      figma.notify('QR code deleted');
      break;
    }

    case 'delete-multiple': {
      await deleteMultipleRecords(msg.ids);
      const records = await loadRecords();
      figma.ui.postMessage({ type: 'records-loaded', records });
      figma.notify(`${msg.ids.length} QR code(s) deleted`);
      break;
    }

    case 'update-name': {
      const records = await loadRecords();
      const rec = records.find(r => r.id === msg.id);
      if (rec) {
        rec.name = msg.name;
        rec.modifiedAt = new Date().toISOString();
        await saveRecords(records);
        figma.ui.postMessage({ type: 'records-loaded', records });
      }
      break;
    }

    case 'increment-scan': {
      const records = await loadRecords();
      const rec = records.find(r => r.id === msg.id);
      if (rec) {
        rec.scans += 1;
        await saveRecords(records);
        figma.ui.postMessage({ type: 'records-loaded', records });
      }
      break;
    }

    case 'insert-svg': {
      try {
        insertSvgIntoFigma(msg.svg, msg.name || 'QR Code');
        figma.notify('QR code inserted into canvas');
      } catch (e: any) {
        figma.notify('Failed to insert QR code: ' + e.message, { error: true });
      }
      break;
    }

    case 'get-selection': {
      const frame = await getSelectedFrameData();
      figma.ui.postMessage({ type: 'selection-data', frame });
      break;
    }

    case 'export-frame': {
      const dataUrl = await exportFrameAsDataUrl(msg.frameId);
      figma.ui.postMessage({ type: 'frame-exported', dataUrl });
      break;
    }

    case 'resize': {
      figma.ui.resize(msg.width || 840, msg.height || 580);
      break;
    }

    case 'close': {
      figma.closePlugin();
      break;
    }
  }
};

// Listen for selection changes
figma.on('selectionchange', async () => {
  const frame = await getSelectedFrameData();
  figma.ui.postMessage({ type: 'selection-changed', frame });
});
