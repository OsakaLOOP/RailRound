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
  server: {
    proxy: {
      // 1. 转发博客页面请求
      '/blog': {
        target: 'http://localhost:4321',
        changeOrigin: true,
      },
      // 2. 转发 Astro 开发环境特有的内部资源请求 (带 @ 符号的路径)
      '^/@(id|fs|vite|astro|astro-dev-toolbar)': {
        target: 'http://localhost:4321',
        changeOrigin: true,
        ws: true
      },
      // 3. 转发来自博客组件的样式请求 (由于主应用不使用 .astro，这里可以安全转发)
      '^/src/.*\\.astro': {
        target: 'http://localhost:4321',
        changeOrigin: true
      }
    }
  }
})
