require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Mux } = require('@mux/mux-node');

const app = express();
app.use(cors());
app.use(express.json());

// Correct constructor for current Mux SDK
const mux = new Mux({ tokenId: process.env.MUX_TOKEN_ID, tokenSecret: process.env.MUX_TOKEN_SECRET });

app.post('/api/mux-upload', async (req, res) => {
  try {
    const upload = await mux.video.uploads.create({
      new_asset_settings: { playback_policy: 'public' },
      cors_origin: '*',
    });
    res.json({ uploadUrl: upload.url, uploadId: upload.id });
  } catch (error) {
    console.error('Mux upload error:', error);
    res.status(500).json({ error: error.message, detail: error });
  }
});

app.get('/api/mux-playback-by-asset/:assetId', async (req, res) => {
  try {
    const asset = await mux.video.assets.retrieve(req.params.assetId);
    const playbackId = asset.playback_ids?.[0]?.id;
    if (!playbackId) {
      return res.status(200).json({ processing: asset.status !== 'ready', asset });
    }
    res.json({ playbackUrl: `https://stream.mux.com/${playbackId}.m3u8` });
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
        const playbackId = asset.playback_ids?.[0]?.id;
        if (playbackId) {
          return res.json({ playbackUrl: `https://stream.mux.com/${playbackId}.m3u8`, assetId });
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
      const playbackId = asset.playback_ids?.[0]?.id;
      if (playbackId) {
        return res.json({ playbackUrl: `https://stream.mux.com/${playbackId}.m3u8`, assetId: asset.id });
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

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Mux backend server running at http://localhost:${PORT}`);
});