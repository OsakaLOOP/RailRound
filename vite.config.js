import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'
import path from 'path'
import sirv from 'sirv'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        railGraphMvp: path.resolve(__dirname, 'rail-graph-mvp.html')
      }
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'serve-static-blog',
      configureServer(server) {
        const blogDistPath = path.resolve(__dirname, 'blog/dist')
        const serve = sirv(blogDistPath, {
          dev: true,
          single: '404.html',
          etag: true
        })
        const blog404Path = path.join(blogDistPath, '404.html')
        const blog404Html = fs.existsSync(blog404Path) ? fs.readFileSync(blog404Path, 'utf8') : null

        server.middlewares.use((req, res, next) => {
          const originalUrl = req.url || ''
          if (
            !originalUrl.startsWith('/blog') ||
            originalUrl.startsWith('/blog/src/') ||
            originalUrl.startsWith('/blog/node_modules/')
          ) {
            next()
            return
          }

          const queryIndex = originalUrl.indexOf('?')
          const pathname = queryIndex >= 0 ? originalUrl.slice(0, queryIndex) : originalUrl
          const search = queryIndex >= 0 ? originalUrl.slice(queryIndex) : ''

          // Normalize directory-like blog paths to trailing slash so Astro static
          // output under <dir>/index.html resolves correctly.
          if (pathname === '/blog' || pathname === '/blog/') {
            res.statusCode = 302
            res.setHeader('Location', `/blog/zh-cn/${search}`)
            res.end()
            return
          }
          if (!pathname.endsWith('/') && !path.posix.extname(pathname)) {
            res.statusCode = 302
            res.setHeader('Location', `${pathname}/${search}`)
            res.end()
            return
          }

          req.url = `${pathname.replace(/^\/blog/, '') || '/'}${search}`
          serve(req, res, () => {
            // Keep unmatched /blog/* inside blog space instead of falling through
            // to app SPA routes.
            if (blog404Html) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'text/html; charset=utf-8')
              res.end(blog404Html)
              return
            }
            req.url = originalUrl
            next()
          })
        })
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
    proxy: {}
  }
})
