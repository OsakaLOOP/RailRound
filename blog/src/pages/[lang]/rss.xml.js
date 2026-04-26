import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../../consts';
import {
  BLOG_LANGS,
  DEFAULT_BLOG_LANG,
  getPostSlug,
  isBlogLang,
  toUrlCategory,
} from '../../utils/blogRouting';

export async function getStaticPaths() {
  return BLOG_LANGS.map((lang) => ({ params: { lang } }));
}

export async function GET(context) {
  const langParam = context.params.lang;
  const lang = isBlogLang(langParam) ? langParam : DEFAULT_BLOG_LANG;

  const posts = await getCollection('blog', ({ id }) => id.startsWith(`${lang}/`));

  return rss({
    title: `${SITE_TITLE} (${lang})`,
    description: SITE_DESCRIPTION,
    site: context.site,
    items: posts
      .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
      .map((post) => {
        const slug = getPostSlug(post.id, post.data.version);
        const category = toUrlCategory(post.data.category || 'dev');
        return {
          title: post.data.title,
          pubDate: post.data.pubDate,
          description: post.data.description,
          link: `/blog/${lang}/${category}/${slug}/`,
          categories: [category, ...post.data.tags],
        };
      }),
  });
}
