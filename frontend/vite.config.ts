import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const certsDir = path.resolve(__dirname, '../certs')

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
  },
  server: {
    https: {
      key:  fs.readFileSync(path.join(certsDir, 'localhost+2-key.pem')),
      cert: fs.readFileSync(path.join(certsDir, 'localhost+2.pem')),
    },
    host: '0.0.0.0',   // reachable on LAN (10.0.0.46)
    proxy: {
      '/api': {
        target: 'https://localhost:8000',
        secure: false,   // allow self-signed cert on backend proxy leg
      },
    },
  },
})
