require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const { Mux } = require('@mux/mux-node');

const app = express();

app.use(cors({
  origin: [
    'https://movie-app-three-gold-76.vercel.app',
    'http://localhost:5173'
  ],
  credentials: true
}));
console.log('CORS setup for:', [
  'https://movie-app-three-gold-76.vercel.app',
  'http://localhost:5173'
]);

app.use(express.json());
app.use(fileUpload());

// Log mọi request
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Khởi tạo Mux SDK đúng cách
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

// Endpoint upload video
app.post('/api/mux-upload', async (req, res) => {
  console.log('Received upload request');
  try {
    if (!req.files || !req.files.video) {
      console.error('No video file uploaded');
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    // Ví dụ: upload lên Mux từ buffer (nâng cấp sau)
    // const asset = await mux.video.assets.create({ ... });
    console.log('Video file:', req.files.video.name);
    res.json({ success: true });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server (Railway sẽ tự chọn PORT qua biến môi trường)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});