// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://rail.s3xyseia.xyz',
  base: '/blog',
  integrations: [mdx(), sitemap(), react()],

  i18n: {
      defaultLocale: 'zh-cn',
      locales: ['zh-cn', 'en', 'ja-jp', 'zh-tw'],
      routing: {
          prefixDefaultLocale: false,
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
  },
});