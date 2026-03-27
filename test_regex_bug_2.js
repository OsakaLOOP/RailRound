const fs = require('fs');

const renderMarkdown = (text) => {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let listBuffer = [];
  let contentIndentClass = 'ml-4';

  const parseInline = (text) => {
    if (!text) return { __html: '' };
    let processed = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, txt, url) => {
      const isGreen = txt.includes('CR200J') || url.includes('CR200J');
      const classes = isGreen
        ? "text-emerald-600 hover:text-emerald-800 hover:underline transition-colors font-medium"
        : "text-blue-600 hover:text-blue-800 hover:underline transition-colors font-medium";
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="${classes}">${txt}</a>`;
    });
    processed = processed.replace(/\*\*(.*?)\*\*/g, '<span class="font-bold">$1</span>');
    processed = processed.replace(/\*([^*]+)\*/g, '<span class="italic">$1</span>');
    return { __html: processed };
  };

  const flushList = () => {
    if (listBuffer.length === 0) return;

    const roots = [];
    const stack = [{ level: -1, children: roots }];

    listBuffer.forEach(item => {
      while (stack.length > 1 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      const newNode = { ...item, children: [] };
      parent.children.push(newNode);
      stack.push(newNode);
    });

    listBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    if (trimmed === '---' || trimmed === '***') {
      flushList();
      continue;
    }

    if (line.match(/^#\s/)) {
      flushList();
      contentIndentClass = 'ml-4';
      continue;
    }
    if (line.match(/^##\s/)) {
      flushList();
      contentIndentClass = 'ml-4';
      continue;
    }
    if (line.match(/^###\s/)) {
      flushList();
      contentIndentClass = 'ml-8';
      continue;
    }
    if (line.match(/^####\s/)) {
        flushList();
        contentIndentClass = 'ml-12';
        continue;
      }

    // List Items (- or *)
    const listMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (listMatch) {
      const indent = listMatch[1].length;
      const content = listMatch[3];
      listBuffer.push({ level: indent, content });
      continue;
    }

    flushList();

    if (trimmed.startsWith('> ')) {
      parseInline(trimmed.substring(2));
      continue;
    }

    parseInline(trimmed);
  }

  flushList();
  return elements;
};

const text = fs.readFileSync('public/readme/zh-cn.md', 'utf-8');
console.time('renderMarkdown');
for (let i = 0; i < 100; i++) {
    renderMarkdown(text);
}
console.timeEnd('renderMarkdown');
