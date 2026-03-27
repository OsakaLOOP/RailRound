const fs = require('fs');

const renderMarkdown = (text) => {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let listBuffer = [];

  // Track context for indentation of non-header content
  // Default (start/after H1): ml-4
  // After H2 (ml-0): ml-4
  // After H3 (ml-4): ml-8
  // After H4 (ml-8): ml-12
  let contentIndentClass = 'ml-4';

  // Helper to parse inline styles (Bold and Links)
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

  // Helper to render buffered list items into a nested structure
  const flushList = () => {
    if (listBuffer.length === 0) return;

    // Build tree from flat list with indent levels
    const roots = [];
    const stack = [{ level: -1, children: roots }];

    listBuffer.forEach(item => {
      // Find parent with level < item.level
      while (stack.length > 1 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      const newNode = { ...item, children: [] };
      parent.children.push(newNode);
      stack.push(newNode);
    });

    // Recursive render function
    const renderTree = (nodes) => {
      if (!nodes || nodes.length === 0) return null;
      return nodes.map((node, i) => {
            // Check for key-value format: - **Key**: Value
            const kvMatch = node.content.match(/^(\*\*.*?\*\*:\s+)(.*)$/);
            // mock render
            return 1;
      });
    };

    renderTree(roots);
    listBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line: flush list
    if (!trimmed) {
      flushList();
      continue;
    }

    // Horizontal Rule (--- or ***)
    if (trimmed === '---' || trimmed === '***') {
      flushList();
      continue;
    }

    // Headers
    if (line.match(/^#\s/)) {
      flushList();
      continue;
    }
    if (line.match(/^##\s/)) {
      flushList();
      continue;
    }
    if (line.match(/^###\s/)) {
      flushList();
      continue;
    }
    if (line.match(/^####\s/)) {
        flushList();
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

const text = fs.readFileSync('public/readme/ja-jp.md', 'utf-8');
console.time('renderMarkdown');
for (let i = 0; i < 100; i++) {
    renderMarkdown(text);
}
console.timeEnd('renderMarkdown');
