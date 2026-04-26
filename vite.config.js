import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import Sitemap from 'vite-plugin-sitemap'
import { fileURLToPath } from 'url'
import path from 'path'
import sirv from 'sirv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
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
    {
      name: 'serve-static-blog',
      configureServer(server) {
        const blogDistPath = path.resolve(__dirname, 'blog/dist');
        const serve = sirv(blogDistPath, { dev: true, single: false, etag: true });
        
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/blog') && !req.url.startsWith('/blog/src/') && !req.url.startsWith('/blog/node_modules/')) {
            // 将 /blog 前缀去除后传给 sirv，使其在 blog/dist 中查找
            const url = req.url.replace(/^\/blog/, '') || '/';
            // 如果去掉前缀后变为空，强制设为 /
            req.url = url === '' ? '/' : url;

            serve(req, res, next);
          } else {
            next();
          }
        });
      }
    }
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@blog-src': path.resolve(__dirname, 'blog/src'),
    },
  },
  server: {
    // 移除所有 Astro 代理规则，统一由 serve-static-blog 处理
    proxy: {}
  }
})
