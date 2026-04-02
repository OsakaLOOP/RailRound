const fs = require('fs');

const parseCSV = (csvStr) => {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < csvStr.length; i++) {
        const char = csvStr[i];

        if (char === '"' && csvStr[i+1] === '"') {
            currentCell += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentCell);
            currentCell = '';
        } else if (char === '\n' && !inQuotes) {
            currentRow.push(currentCell);
            rows.push(currentRow);
            currentRow = [];
            currentCell = '';
        } else if (char === '\r' && !inQuotes) {
            // ignore
        } else {
            currentCell += char;
        }
    }

    if (currentRow.length > 0 || currentCell !== '') {
        currentRow.push(currentCell);
        rows.push(currentRow);
    }

    return rows;
}

const csvData = `"No","日付","処理金額","チャージなど","処理","詳細","残高"
"227","8月 22, 2025","519","","自動改札機 運賃支払（改札出場）","入: モノレール浜松町（東京モノレール羽田空港線 東京モノレール）
出: 羽田空港第2ターミナル（東京モノレール羽田空港線 東京モノレール）","3305"
"218","8月 22, 2025","327","","連絡改札機 運賃支払（改札出場）","入: 羽田空港第1･第2ターミナル（空港線 京浜急行電鉄）
出: 品川（本線 京浜急行電鉄）","5087"`;

const parsed = parseCSV(csvData);
console.log(parsed);

const parseDate = (dateStr) => {
    // "8月 22, 2025" -> 2025-08-22
    const match = dateStr.match(/(\d+)月 (\d+), (\d+)/);
    if (match) {
        const month = match[1].padStart(2, '0');
        const day = match[2].padStart(2, '0');
        const year = match[3];
        return `${year}-${month}-${day}`;
    }
    return dateStr;
}

const parseDetails = (detailsStr) => {
    // 入: モノレール浜松町（東京モノレール羽田空港線 東京モノレール）
    // 出: 羽田空港第2ターミナル（東京モノレール羽田空港線 東京モノレール）
    const regex = /入:\s*(.+?)（(.+?)\s+(.+?)）\n?出:\s*(.+?)（(.+?)\s+(.+?)）/;
    const match = detailsStr.match(regex);
    if (match) {
        return {
            inStation: match[1].trim(),
            inLine: match[2].trim(),
            inCompany: match[3].trim(),
            outStation: match[4].trim(),
            outLine: match[5].trim(),
            outCompany: match[6].trim()
        }
    }
    return null;
}

for (const row of parsed.slice(1)) {
    console.log(parseDate(row[1]));
    console.log(parseDetails(row[5]));
}
