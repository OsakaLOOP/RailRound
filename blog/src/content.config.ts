import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// Pattern handles nested directories for localization: src/content/blog/[lang]/[slug].mdx
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: z.optional(image()),
			// 分类: dev | docs | guide | release
			category: z.enum(['dev', 'docs', 'guide']).default('dev'),
			// 标签列表
			tags: z.array(z.string()).default([]),
			// 对应的 changelog 版本号, 用于 VersionBadge 跳转
			version: z.string().optional(),
			// 文件夹/系列组
			series: z.string().optional(),
		}),
});

export const collections = { blog };
