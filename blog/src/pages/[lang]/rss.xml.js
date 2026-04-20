import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../../consts';

export async function getStaticPaths() {
	return [
		{ params: { lang: 'en' } },
		{ params: { lang: 'ja-jp' } },
		{ params: { lang: 'zh-tw' } },
	];
}

export async function GET(context) {
    const { lang } = context.params;
	const posts = await getCollection('blog', ({ id }) => id.startsWith(`${lang}/`));
	return rss({
		title: `${SITE_TITLE} (${lang})`,
		description: SITE_DESCRIPTION,
		site: context.site,
		items: posts
			.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
			.map((post) => {
                const slugPart = post.id.split('/').pop();
                const slug = post.data.version ? `v${post.data.version}` : slugPart;
                const category = post.data.category || 'dev';
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
