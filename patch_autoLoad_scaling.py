import re

with open('src/AppLayout.tsx', 'r') as f:
    content = f.read()

# Replace percentage updates
content = content.replace("读取本地缓存... (30%)", "读取本地缓存... (20%)")
content = content.replace("width: '30%'", "width: '20%'") # this might hit multiple, let's be careful

# A safer way is to regex replace the exact blocks or use targeted string replacements
def replace_toast(old_text, old_prog_str, new_text, new_prog_str):
    global content

    old_block = f"""<span className="text-sm font-bold text-gray-700">{old_text}</span>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{{{ width: '{old_prog_str}%' }}}}></div>"""
    new_block = f"""<span className="text-sm font-bold text-gray-700">{new_text}</span>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{{{ width: '{new_prog_str}%' }}}}></div>"""

    content = content.replace(old_block, new_block)

replace_toast("读取本地缓存... (30%)", "30", "读取本地缓存... (20%)", "20")
replace_toast("解析本地数据... (50%)", "50", "解析本地数据... (30%)", "30")
replace_toast("极速命中缓存... (50%)", "50", "极速命中缓存... (30%)", "30")
replace_toast("加载行程缩略图... (60%)", "60", "加载行程缩略图... (40%)", "40")
replace_toast("检查云端更新... (70%)", "70", "检查云端更新... (45%)", "45")

# For the download loop:
# old: const progress = 70 + Math.round((downloadedCount / totalToDownload) * 20); // Scale up to 90%
# new: const progress = 45 + Math.round((downloadedCount / totalToDownload) * 5); // Scale up to 50%
content = content.replace(
    "const progress = 70 + Math.round((downloadedCount / totalToDownload) * 20); // Scale up to 90%",
    "const progress = 45 + Math.round((downloadedCount / totalToDownload) * 5); // Scale up to 50%"
)

# For the distance calculation worker initialization
replace_toast("预计算全图站距... (90%)", "90", "预计算全图站距... (50%)", "50")

# For the worker progress loop:
# old: const scaledProgress = 90 + Math.round(payload.progress * 0.1); // Map 0-100 to 90-100
# new: const scaledProgress = 50 + Math.round(payload.progress * 0.5); // Map 0-100 to 50-100
content = content.replace(
    "const scaledProgress = 90 + Math.round(payload.progress * 0.1); // Map 0-100 to 90-100",
    "const scaledProgress = 50 + Math.round(payload.progress * 0.5); // Map 0-100 to 50-100"
)

with open('src/AppLayout.tsx', 'w') as f:
    f.write(content)
