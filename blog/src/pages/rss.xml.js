import { DEFAULT_BLOG_LANG } from '../utils/blogRouting';

export function GET(context) {
  const base = context.site ?? context.url;
  const target = new URL(`/blog/${DEFAULT_BLOG_LANG}/rss.xml`, base);
  return Response.redirect(target.toString(), 302);
}
