import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

// Middleware for parsing JSON payloads (up to 50MB for high-res industrial CAD and photography)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const PUBLIC_UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');
const SLOT_JSON_PATH = path.join(process.cwd(), 'src', 'data', 'slotImages.json');

// Ensure upload directory exists
if (!fs.existsSync(PUBLIC_UPLOADS_DIR)) {
  fs.mkdirSync(PUBLIC_UPLOADS_DIR, { recursive: true });
}

// Serve public directory statically
app.use('/uploads', express.static(PUBLIC_UPLOADS_DIR));
app.use(express.static(path.join(process.cwd(), 'public')));

// Default fallbacks for all image slots
const DEFAULT_SLOTS: Record<string, string> = {
  hero_context: 'Gemini_Generated_Image_6jyu4q6jyu4q6jyu.jpg',
  hero_side: '',
  hero_front: '',
  hero_top: '',
  cad_master: 'Gemini_Generated_Image_8hf5sg8hf5sg8hf5.jpg',
  cad_front: '',
  cad_side: '',
  cad_top: '',
  cad_section: '',
  iteration_rear: 'Gemini_Generated_Image_olzrw2olzrw2olzr.jpg',
  spec_hero: 'Gemini_Generated_Image_6jyu4q6jyu4q6jyu.jpg',
  spec_joint: '',
  spec_fabric: ''
};

// Helper: read current slots
function getSlotRegistry(): Record<string, string> {
  try {
    if (fs.existsSync(SLOT_JSON_PATH)) {
      const data = fs.readFileSync(SLOT_JSON_PATH, 'utf-8');
      return { ...DEFAULT_SLOTS, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Error reading slotImages.json:', err);
  }
  return { ...DEFAULT_SLOTS };
}

// Helper: write slots registry
function saveSlotRegistry(data: Record<string, string>) {
  try {
    fs.writeFileSync(SLOT_JSON_PATH, JSON.stringify(data, null, 2), 'utf-8');
    // Also mirror to public if present
    const publicSlotPath = path.join(process.cwd(), 'public', 'slotImages.json');
    fs.writeFileSync(publicSlotPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing slotImages.json:', err);
  }
}

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', serverTime: new Date().toISOString() });
});

// GET current slot assignments
app.get('/api/image-slots', (req, res) => {
  const slots = getSlotRegistry();
  res.json({ success: true, slots });
});

// POST permanent image upload directly into project source code
app.post('/api/upload-slot-image', (req, res) => {
  try {
    const { slotId, filename, base64Data } = req.body;

    if (!slotId || !base64Data) {
      return res.status(400).json({ success: false, error: 'slotId and base64Data are required.' });
    }

    // Strip Data URI prefix (e.g. data:image/png;base64,...)
    const matches = base64Data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    let buffer: Buffer;
    let ext = 'jpg';

    if (matches && matches.length === 3) {
      const mime = matches[1];
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('svg')) ext = 'svg';
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(base64Data, 'base64');
    }

    // Clean filename
    const safeName = filename
      ? filename.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase()
      : `asset_${Date.now()}.${ext}`;

    const finalFileName = `${slotId}_${Date.now()}_${safeName}`;
    const targetFilePath = path.join(PUBLIC_UPLOADS_DIR, finalFileName);

    // Write file directly to project's static assets directory on disk
    fs.writeFileSync(targetFilePath, buffer);
    console.log(`[Permanent Asset Upload] Saved ${targetFilePath} (${buffer.length} bytes)`);

    // Public URL path
    const staticUrl = `/uploads/${finalFileName}`;

    // Update permanent JSON registry in source code
    const currentSlots = getSlotRegistry();
    currentSlots[slotId] = staticUrl;
    saveSlotRegistry(currentSlots);

    return res.json({
      success: true,
      slotId,
      url: staticUrl,
      fileName: finalFileName,
      sizeBytes: buffer.length
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to save asset' });
  }
});

// Reset a slot back to default
app.post('/api/reset-slot-image', (req, res) => {
  try {
    const { slotId } = req.body;
    if (!slotId) {
      return res.status(400).json({ success: false, error: 'slotId is required.' });
    }

    const currentSlots = getSlotRegistry();
    currentSlots[slotId] = DEFAULT_SLOTS[slotId] || '';
    saveSlotRegistry(currentSlots);

    return res.json({
      success: true,
      slotId,
      url: currentSlots[slotId]
    });
  } catch (err: any) {
    console.error('Reset error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to reset asset' });
  }
});

// Vite Middleware Setup
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Portfolio Server running on http://0.0.0.0:${PORT}`);
  });
}

start();
