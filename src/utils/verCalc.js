// 版本号定义, 格式: "主版本.次版本(一个数字)+修订号(任意位数)", 例如 "0.30, 0.314"
export const verCalc = (verStr) => {
    const parts = verStr.split('.').map(num => parseInt(num, 10));
    while (parts.length < 3 || isNaN(parts[2])) { parts.push(0); }
    return { major: parts[0], minor: parts[1], patch: parts[2] };// ver 对象
};

// 版本号比较
export const verCmp = (ver1, ver2) => {
    const v1 = verCalc(ver1);
    const v2 = verCalc(ver2);
    if (v1.major !== v2.major) return { diff: v1.major - v2.major, at: 'major' };
    if (v1.minor !== v2.minor) return { diff: v1.minor - v2.minor, at: 'minor' };
    return { diff: v1.patch - v2.patch, at: 'patch' };
}

export const isVerSupported = (ver1, ver2) => {
    return verCmp(ver1, ver2).diff >= 0;
}