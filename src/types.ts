export interface QRCodeRecord {
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
  customization: QRCustomization;
  svgData?: string;
}

export interface QRCustomization {
  foreground: string;
  background: string;
  errorCorrection: 'L' | 'M' | 'Q' | 'H';
  size: number;
  margin: number;
  style: 'square' | 'rounded' | 'dots';
}

export interface PluginMessage {
  type: string;
  [key: string]: any;
}

export const DEFAULT_CUSTOMIZATION: QRCustomization = {
  foreground: '#000000',
  background: '#FFFFFF',
  errorCorrection: 'M',
  size: 256,
  margin: 4,
  style: 'square',
};

export const CATEGORIES = [
  'Website',
  'Social Media',
  'Business Card',
  'Product',
  'Event',
  'Menu',
  'Payment',
  'WiFi',
  'Other',
];
