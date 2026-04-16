import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import Sitemap from 'vite-plugin-sitemap'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),
    tailwindcss(),
    Sitemap({
      hostname: 'https://rail.s3xyseia.xyz',
      dynamicRoutes: [
        '/zh-cn',
        '/zh-tw',
        '/en',
        '/ja-jp'
      ]
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
})
