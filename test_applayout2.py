with open('src/AppLayout.tsx', 'r') as f:
    content = f.read()
print(content[content.find('// 必须在这里同步生成并调用 setTripSegmentsGeometry'):content.find('fetchMissing();')])
