with open('src/AppLayout.tsx', 'r') as f:
    content = f.read()
print(content[content.find('// 1. 优先使用已有的缓存进行渲染'):content.find('// 2. 筛选缺失的数据发送给 Worker')])
