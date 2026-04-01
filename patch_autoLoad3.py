import re

with open('src/AppLayout.tsx', 'r') as f:
    content = f.read()

# Fix 1: The fast path should be 50%, not 80%, to not jump backward to 60%.
old_fast_path = """                if (precompiledGeoData && precompiledRailwayData && realFiles.length > 0) {
                    toast.loading(
            (t: any) => (
                <div className="flex flex-col gap-2 w-48">
                    <span className="text-sm font-bold text-gray-700">极速命中缓存... (80%)</span>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: '80%' }}></div>
                    </div>
                </div>
            ),
            { id: toastId, duration: Infinity }
        );"""

new_fast_path = """                if (precompiledGeoData && precompiledRailwayData && realFiles.length > 0) {
                    toast.loading(
            (t: any) => (
                <div className="flex flex-col gap-2 w-48">
                    <span className="text-sm font-bold text-gray-700">极速命中缓存... (50%)</span>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: '50%' }}></div>
                    </div>
                </div>
            ),
            { id: toastId, duration: Infinity }
        );"""

content = content.replace(old_fast_path, new_fast_path)

# Fix 2: The JSX string interpolation bug in the download section
old_download_text = """<span className="text-sm font-bold text-gray-700">下载更新 ${downloadedCount}/${totalToDownload}... (${progress}%)</span>"""
new_download_text = """<span className="text-sm font-bold text-gray-700">{`下载更新 ${downloadedCount}/${totalToDownload}... (${progress}%)`}</span>"""
content = content.replace(old_download_text, new_download_text)


with open('src/AppLayout.tsx', 'w') as f:
    f.write(content)
