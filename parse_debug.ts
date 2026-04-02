import { parseCSV, parseSuicaDetails } from './src/utils/suicaParser';

const csvData = `"No","日付","処理金額","チャージなど","処理","詳細","残高"
"205","8月 20, 2025","2640","","自動改札機 運賃支払（改札出場）","入: 日光（日光線 JR東日本）\n出: 水戸（常磐線 JR東日本）","2429"
"201","8月 19, 2025","324","","自動改札機 運賃支払（改札出場）","入: 鬼怒川温泉（鬼怒川線 東武鉄道）\n出: 東武日光（日光線 東武鉄道）","69"`;

const rows = parseCSV(csvData);
for (const row of rows.slice(1)) {
    console.log(parseSuicaDetails(row[5]));
}
