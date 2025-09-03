require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const { Mux } = require('@mux/mux-node');

const app = express();
app.use(cors({
  origin: [
    'https://movie-app-three-gold-76.vercel.app', // FE trên Vercel
    'http://localhost:5173' // FE local
  ],
  credentials: true
}));
console.log('CORS setup for:', [
  'https://movie-app-three-gold-76.vercel.app',
  'http://localhost:5173'
]);
app.use(express.json());
app.use(fileUpload());

// Correct constructor for current Mux SDK, include signing key if provided
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
  signingKeyId: process.env.MUX_SIGNING_KEY_ID,
  signingKeySecret: process.env.MUX_SIGNING_KEY_SECRET,
});

const ADMIN_DELETE_PASSWORD = process.env.ADMIN_DELETE_PASSWORD;

// Simple password check middleware for admin operations
function requireAdminPassword(req, res, next) {
  const provided = req.headers['x-admin-password'] || req.body?.password || req.query?.password;
  // Accept multiple env names in case of typos/misconfig
  const expected = process.env.ADMIN_DELETE_PASSWORD 
    || process.env.ADMIN_PASSWORD 
    || process.env.DMIN_DELETE_PASSWORD; // fallback for common typo
  if (!expected) {
    return res.status(500).json({ error: 'ADMIN_DELETE_PASSWORD is not configured on server' });
  }
  if (provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized: invalid admin password' });
  }
  next();
}

app.post('/api/mux-upload', async (req, res) => {
  console.log('Received upload request');
  try {
    if (!req.files || !req.files.video) {
      console.error('No video file uploaded');
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    // Xử lý upload lên Mux ở đây...
    console.log('Video file:', req.files.video.name);
    res.json({ success: true });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mux-playback-by-asset/:assetId', async (req, res) => {
  try {
    let asset = await mux.video.assets.retrieve(req.params.assetId);
    let playbackId = asset.playback_ids?.[0]?.id;

    // If asset has no playback id, create a public one now
    if (!playbackId) {
      try {
        const created = await mux.video.assets.playbackIds.create(asset.id, { policy: 'public' });
        playbackId = created.id;
        // refresh asset info (optional)
        asset = await mux.video.assets.retrieve(asset.id);
      } catch (e) {
        const code = e?.status || e?.statusCode || 500;
        console.error('Create public playback id error:', code, e?.message);
      }
    }

    if (!playbackId) {
      return res.status(200).json({ processing: asset.status !== 'ready', asset });
    }
    res.json({ playbackUrl: `https://stream.mux.com/${playbackId}.m3u8`, playbackId });
  } catch (error) {
    const code = error?.status || error?.statusCode || 500;
    console.error('Get playback by asset error:', code, error?.message);
    if (code === 404) return res.status(200).json({ processing: true });
    res.status(500).json({ error: error.message, code });
  }
});

// Inspect raw upload status (debug/help quickly)
app.get('/api/mux-upload-status/:uploadId', async (req, res) => {
  try {
    const upload = await mux.video.uploads.retrieve(req.params.uploadId);
    res.json(upload);
  } catch (error) {
    const code = error?.status || error?.statusCode || 500;
    console.error('Get upload status error:', code, error?.message);
    if (code === 404) return res.status(200).json({ processing: true });
    res.status(500).json({ error: error.message, code });
  }
});

// More robust: try resolving as uploadId first, then as assetId
app.get('/api/mux-playback/:id', async (req, res) => {
  const id = req.params.id;
  try {
    // Try resolve via Upload
    try {
      const upload = await mux.video.uploads.retrieve(id);
      const assetId = upload?.asset_id;
      if (assetId) {
        const asset = await mux.video.assets.retrieve(assetId);
        let playbackId = asset.playback_ids?.[0]?.id;
        if (!playbackId) {
          try {
            const created = await mux.video.assets.playbackIds.create(asset.id, { policy: 'public' });
            playbackId = created.id;
          } catch (e) {
            console.error('Create playback id error:', e?.status || e?.statusCode, e?.message);
          }
        }
        if (playbackId) {
          return res.json({ playbackUrl: `https://stream.mux.com/${playbackId}.m3u8`, assetId, playbackId });
        }
        return res.json({ processing: true, assetId, asset });
      }
      // If no asset yet, report processing
      return res.json({ processing: true });
    } catch (e) {
      const code = e?.status || e?.statusCode;
      console.warn('Upload lookup failed:', code, e?.message);
      if (code === 404) {
        // Keep trying as asset below
      }
    }

    // Try resolve as Asset ID directly
    try {
      const asset = await mux.video.assets.retrieve(id);
      let playbackId = asset.playback_ids?.[0]?.id;
      if (!playbackId) {
        try {
          const created = await mux.video.assets.playbackIds.create(asset.id, { policy: 'public' });
          playbackId = created.id;
        } catch (e2) {
          console.error('Create playback id error:', e2?.status || e2?.statusCode, e2?.message);
        }
      }
      if (playbackId) {
        return res.json({ playbackUrl: `https://stream.mux.com/${playbackId}.m3u8`, assetId: asset.id, playbackId });
      }
      return res.json({ processing: asset.status !== 'ready', asset });
    } catch (e2) {
      const code = e2?.status || e2?.statusCode || 500;
      console.error('Mux playback resolve error:', code, e2?.message);
      if (code === 404) return res.status(200).json({ processing: true });
      return res.status(500).json({ error: e2.message, code });
    }
  } catch (error) {
    console.error('Unexpected error resolving playback:', error);
    res.status(500).json({ error: error.message });
  }
});

// Signed playback endpoints (fallback if 412 or restricted)
app.get('/api/mux-signed-playback-by-asset/:assetId', async (req, res) => {
  try {
    if (!process.env.MUX_SIGNING_KEY_ID || !process.env.MUX_SIGNING_KEY_SECRET) {
      return res.status(400).json({ error: 'Signing keys not configured' });
    }
    const asset = await mux.video.assets.retrieve(req.params.assetId);
    let playbackId = asset.playback_ids?.[0]?.id;
    if (!playbackId) {
      const created = await mux.video.assets.playbackIds.create(asset.id, { policy: 'signed' });
      playbackId = created.id;
    }
    const token = mux.jwt.signPlaybackId(playbackId, { type: 'video' });
    return res.json({ playbackUrl: `https://stream.mux.com/${playbackId}.m3u8?token=${token}`, playbackId });
  } catch (error) {
    console.error('Signed playback (asset) error:', error?.status || error?.statusCode, error?.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mux-signed-playback/:playbackId', async (req, res) => {
  try {
    if (!process.env.MUX_SIGNING_KEY_ID || !process.env.MUX_SIGNING_KEY_SECRET) {
      return res.status(400).json({ error: 'Signing keys not configured' });
    }
    const token = mux.jwt.signPlaybackId(req.params.playbackId, { type: 'video' });
    return res.json({ playbackUrl: `https://stream.mux.com/${req.params.playbackId}.m3u8?token=${token}` });
  } catch (error) {
    console.error('Signed playback error:', error?.status || error?.statusCode, error?.message);
    res.status(500).json({ error: error.message });
  }
});

// Delete a Mux asset (admin protected)
app.delete('/api/mux-asset/:assetId', requireAdminPassword, async (req, res) => {
  try {
    const assetId = req.params.assetId;
    await mux.video.assets.delete(assetId);
    return res.json({ ok: true });
  } catch (error) {
    const code = error?.status || error?.statusCode || 500;
    console.error('Delete asset error:', code, error?.message);
    // If already gone, consider it success for idempotency
    if (code === 404) return res.json({ ok: true, alreadyDeleted: true });
    res.status(code).json({ error: error.message, code });
  }
});

// Flexible delete: accepts { assetId?, playbackId?, playbackUrl? }
app.post('/api/mux-asset/delete', async (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_DELETE_PASSWORD) {
    return res.status(403).json({ error: 'Sai mật khẩu quản trị' });
  }

  try {
    const { assetId: bodyAssetId, playbackId: bodyPlaybackId, playbackUrl } = req.body || {};
    let assetId = bodyAssetId;

    if (!assetId) {
      // Try to extract playbackId
      let playbackId = bodyPlaybackId;
      if (!playbackId && typeof playbackUrl === 'string') {
        const match = playbackUrl.match(/stream\.mux\.com\/(.*?)(\.m3u8|\?|$)/);
        playbackId = match ? match[1] : undefined;
      }
      if (playbackId) {
        try {
          const playback = await mux.video.playbackIds.retrieve(playbackId);
          assetId = playback?.object?.id;
        } catch (e) {
          const code = e?.status || e?.statusCode;
          console.warn('Resolve playbackId->assetId failed:', code, e?.message);
        }
      }
    }

    if (!assetId) {
      return res.status(400).json({ error: 'Missing identifiers. Provide assetId, playbackId, or playbackUrl.' });
    }

    try {
      await mux.video.assets.delete(assetId);
      return res.json({ ok: true, assetId });
    } catch (e) {
      const code = e?.status || e?.statusCode || 500;
      console.error('Flexible delete error:', code, e?.message);
      if (code === 404) return res.json({ ok: true, alreadyDeleted: true, assetId });
      return res.status(code).json({ error: e.message, code });
    }
  } catch (error) {
    console.error('Unexpected flexible delete error::', error);
    res.status(500).json({ error: error.message });
  }
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Mux backend server running at http://localhost:${PORT}`);
});