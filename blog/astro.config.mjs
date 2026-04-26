// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  site: 'https://rail.s3xyseia.xyz',
  base: '/blog',
  integrations: [mdx(), sitemap(), react()],

  i18n: {
      defaultLocale: 'zh-cn',
      locales: ['zh-cn', 'en', 'ja-jp', 'zh-tw'],
      routing: {
          prefixDefaultLocale: true,
      },
  },

  markdown: {
      shikiConfig: {
          theme: 'github-dark',
          wrap: true,
      },
  },

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      preserveSymlinks: true,
      alias: [
        {
          find: '@railloop/route-slice-preview/styles.css',
          replacement: path.resolve(__dirname, '../packages/route-slice-preview/dist/route-slice-preview.css'),
        },
        {
          find: '@railloop/route-slice-preview',
          replacement: path.resolve(__dirname, '../packages/route-slice-preview/dist/index.mjs'),
        },
      ],
    },
  },
});
