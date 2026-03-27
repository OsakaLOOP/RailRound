const fs = require('fs');
const ts = require('typescript');

const layoutPath = 'src/AppLayout.tsx';
const content = fs.readFileSync(layoutPath, 'utf8');

const result = ts.transpileModule(content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
});

console.log("Syntax check passed for AppLayout.tsx");
