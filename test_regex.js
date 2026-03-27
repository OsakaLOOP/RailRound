const fs = require('fs');

const renderMarkdown = (text) => {
  if (!text) return null;
  const lines = text.split('\n');

  const parseInline = (text) => {
    if (!text) return { __html: '' };

    // Pass 1: Links [text](url)
    let processed = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, txt, url) => {
      const isGreen = txt.includes('CR200J') || url.includes('CR200J');
      const classes = isGreen
        ? "text-emerald-600 hover:text-emerald-800 hover:underline transition-colors font-medium"
        : "text-blue-600 hover:text-blue-800 hover:underline transition-colors font-medium";
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="${classes}">${txt}</a>`;
    });

    // Pass 2: Bold (**text**)
    processed = processed.replace(/\*\*(.*?)\*\*/g, '<span class="font-bold">$1</span>');

    // Pass 3: Italic (*text*)
    processed = processed.replace(/\*([^*]+)\*/g, '<span class="italic">$1</span>');

    return { __html: processed };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (listMatch) {
      continue;
    }

    if (trimmed.startsWith('> ')) {
      parseInline(trimmed.substring(2));
      continue;
    }

    parseInline(trimmed);
  }
};

const text = fs.readFileSync('public/readme/ja-jp.md', 'utf-8');
console.time('renderMarkdown');
for (let i = 0; i < 100; i++) {
    renderMarkdown(text);
}
console.timeEnd('renderMarkdown');
