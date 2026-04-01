import re

with open('src/AppLayout.tsx', 'r') as f:
    content = f.read()

def replace_toast(old_text, old_prog, new_text, new_prog):
    global content

    # We construct regex that matches the div structure loosely.
    pattern = re.compile(
        rf'<span className="text-sm font-bold text-gray-700">{re.escape(old_text)}</span>\s*<div className="w-full bg-gray-200 rounded-full h-1\.5 overflow-hidden">\s*<div className="bg-blue-500 h-1\.5 rounded-full transition-all duration-300" style={{{{\s*width:\s*\'{old_prog}%\'\s*}}}}></div>'
    )

    replacement = f"""<span className="text-sm font-bold text-gray-700">{new_text}</span>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{{{ width: '{new_prog}%' }}}}></div>"""

    content = pattern.sub(replacement, content)

replace_toast("加载公司数据... (10%)", "10", "加载公司数据... (5%)", "5")
replace_toast("读取本地缓存... (20%)", "20", "读取本地缓存... (10%)", "10")
replace_toast("解析本地数据... (30%)", "30", "解析本地数据... (20%)", "20")
replace_toast("极速命中缓存... (30%)", "30", "极速命中缓存... (20%)", "20")
replace_toast("加载行程缩略图... (40%)", "40", "加载行程缩略图... (25%)", "25")
replace_toast("检查云端更新... (45%)", "45", "检查云端更新... (30%)", "30")

content = content.replace(
    "const progress = 45 + Math.round((downloadedCount / totalToDownload) * 5); // Scale up to 50%",
    "const progress = 30 + Math.round((downloadedCount / totalToDownload) * 20); // Scale up to 50%"
)

with open('src/AppLayout.tsx', 'w') as f:
    f.write(content)
