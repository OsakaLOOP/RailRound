import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 兼容 ES Module 的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const blogDir = path.resolve(rootDir, 'blog');

try {
    console.log('--- 开始构建主应用 (Vite SPA) ---');
    execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

    console.log('\n--- 开始构建静态博客 (Astro) ---');
    execSync('npm run build', { cwd: blogDir, stdio: 'inherit' });

    console.log('\n--- 合并构建产物 ---');
    const mainDist = path.resolve(rootDir, 'dist');
    const blogDist = path.resolve(blogDir, 'dist');
    const targetBlogDist = path.resolve(mainDist, 'blog');

    if (fs.existsSync(blogDist)) {
        // 递归复制文件夹
        const copyRecursiveSync = (src, dest) => {
            const exists = fs.existsSync(src);
            const stats = exists && fs.statSync(src);
            const isDirectory = exists && stats.isDirectory();
            if (isDirectory) {
                if (!fs.existsSync(dest)) {
                    fs.mkdirSync(dest, { recursive: true });
                }
                fs.readdirSync(src).forEach((childItemName) => {
                    copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
                });
            } else {
                fs.copyFileSync(src, dest);
            }
        };

        console.log(`正在合并博客产物到: ${targetBlogDist}`);
        copyRecursiveSync(blogDist, targetBlogDist);
        console.log('✅ 构建产物合并合并完成！可直接将 /dist 部署至 EdgeOne。');
    } else {
        console.error('❌ 错误: 未找到 Astro 博客构建产物！');
        process.exit(1);
    }
} catch (err) {
    console.error('❌ 构建过程中发生错误:', err);
    process.exit(1);
}
