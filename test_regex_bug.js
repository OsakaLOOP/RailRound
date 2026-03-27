const fs = require('fs');
const parseInline = (text) => {
    if (!text) return { __html: '' };

    let processed = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, txt, url) => {
      return `<a href="${url}">${txt}</a>`;
    });

    processed = processed.replace(/\*\*(.*?)\*\*/g, '<span class="font-bold">$1</span>');

    processed = processed.replace(/\*([^*]+)\*/g, '<span class="italic">$1</span>');

    return { __html: processed };
  };

const text = `
    - **关于 Bypass 的警告**: 请务必定时备份本地存储, 或者至少登陆账号, 绑定 [GitHub](https://github.com) 就更好了 (虽然这和存储没有更多关系, 但是可以用于 Socializing). 虽然我们在逻辑上基于 “线路/车站名称和 ID” 进行了深度绑定, 拥有 **12 个 9** 的理论数据可靠性. 这意味着, 即便 [沃贡人](https://hitchhikers.fandom.com/wiki/Vogons) (或者 [JR 北海道](https://www.jrhokkaido.co.jp)) 为了建设一条新的新干线联络线 (这不太可能) 而决定残酷地废线某些物理设施 (这绝对可能), 只要车站 ID 还在, 你的记录就不会随版本更迭而失效. 但如果你清空了缓存且没绑定账号, 数据就会和曾经的地球(消歧义: [The Earth - Supercomputer](https://hitchhikers.fandom.com/wiki/Earth), not [The Earth - Planet](https://en.wikipedia.org/wiki/Earth))一样消失.
`;

console.time('parseInline');
parseInline(text);
console.timeEnd('parseInline');
