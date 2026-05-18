# 仙石線 OSM 配对核对表 (ingest v0)

> 由 `scripts/ingest-senseki.ts` 自动生成. 请检查算法的判断是否正确.
>
> OSM way 链接格式: `https://www.openstreetmap.org/way/{osm_id}` (可点击在线核对几何).

## A. `passenger_lines=2` 复线配对 — 40 对 (80 features)

贪心算法: 对每条 dual feature 找 (1) 端点距离最小 < 100m (2) 长度相近 ±50% 的对端. bearΔ ≈ 180° = 反向平行 (正常); Δ = 两条 LineString 中点距离 (≈ 复线离心距).

| # | a osm_id | b osm_id | nearest_station | lenA / lenB (m) | Δ (m) | bearΔ (°) |
|---|---|---|---|---|---|---|
| 1 | [1320551298](https://www.openstreetmap.org/way/1320551298) | [775723282](https://www.openstreetmap.org/way/775723282) | あおば通 | 125 / 126 | 15 | 179 |
| 2 | [24370516](https://www.openstreetmap.org/way/24370516) | [775730626](https://www.openstreetmap.org/way/775730626) | 苦竹 | 544 / 542 | 34 | 180 |
| 3 | [24370530](https://www.openstreetmap.org/way/24370530) | [775730625](https://www.openstreetmap.org/way/775730625) | 苦竹 | 214 / 212 | 5 | 179 |
| 4 | [1060925838](https://www.openstreetmap.org/way/1060925838) | [989253128](https://www.openstreetmap.org/way/989253128) | 苦竹 | 103 / 104 | 6 | 180 |
| 5 | [1060925839](https://www.openstreetmap.org/way/1060925839) | [989253129](https://www.openstreetmap.org/way/989253129) | 苦竹 | 22 / 22 | 23 | 180 |
| 6 | [103946099](https://www.openstreetmap.org/way/103946099) | [775730624](https://www.openstreetmap.org/way/775730624) | 小鶴新田 | 1244 / 1247 | 4 | 180 |
| 7 | [1188607773](https://www.openstreetmap.org/way/1188607773) | [1188607772](https://www.openstreetmap.org/way/1188607772) | 小鶴新田 | 65 / 66 | 4 | 180 |
| 8 | [1188607775](https://www.openstreetmap.org/way/1188607775) | [1188607774](https://www.openstreetmap.org/way/1188607774) | 小鶴新田 | 26 / 26 | 27 | 180 |
| 9 | [24370562](https://www.openstreetmap.org/way/24370562) | [776215856](https://www.openstreetmap.org/way/776215856) | 小鶴新田 | 530 / 527 | 55 | 180 |
| 10 | [776215936](https://www.openstreetmap.org/way/776215936) | [776215938](https://www.openstreetmap.org/way/776215938) | 小鶴新田 | 35 / 36 | 34 | 180 |
| 11 | [1087054958](https://www.openstreetmap.org/way/1087054958) | [1087054960](https://www.openstreetmap.org/way/1087054960) | 小鶴新田 | 342 / 344 | 4 | 180 |
| 12 | [1087054959](https://www.openstreetmap.org/way/1087054959) | [1087054961](https://www.openstreetmap.org/way/1087054961) | 小鶴新田 | 7 / 7 | 9 | 179 |
| 13 | [776215937](https://www.openstreetmap.org/way/776215937) | [776215939](https://www.openstreetmap.org/way/776215939) | 福田町 | 974 / 974 | 4 | 180 |
| 14 | [1087054957](https://www.openstreetmap.org/way/1087054957) | [1087054955](https://www.openstreetmap.org/way/1087054955) | 福田町 | 6 / 6 | 7 | 180 |
| 15 | [1087054956](https://www.openstreetmap.org/way/1087054956) | [1087054954](https://www.openstreetmap.org/way/1087054954) | 福田町 | 51 / 53 | 19 | 178 |
| 16 | [776217968](https://www.openstreetmap.org/way/776217968) | [776217965](https://www.openstreetmap.org/way/776217965) | 陸前高砂 | 8 / 8 | 9 | 179 |
| 17 | [103832886](https://www.openstreetmap.org/way/103832886) | [776217969](https://www.openstreetmap.org/way/776217969) | 陸前高砂 | 13 / 13 | 14 | 179 |
| 18 | [24370540](https://www.openstreetmap.org/way/24370540) | [776218436](https://www.openstreetmap.org/way/776218436) | 陸前高砂 | 456 / 453 | 27 | 180 |
| 19 | [24370542](https://www.openstreetmap.org/way/24370542) | [776220628](https://www.openstreetmap.org/way/776220628) | 中野栄 | 1621 / 1621 | 44 | 180 |
| 20 | [1188596654](https://www.openstreetmap.org/way/1188596654) | [1188596653](https://www.openstreetmap.org/way/1188596653) | 中野栄 | 14 / 14 | 5 | 179 |
| 21 | [1188596655](https://www.openstreetmap.org/way/1188596655) | [1188596652](https://www.openstreetmap.org/way/1188596652) | 中野栄 | 18 / 18 | 19 | 180 |
| 22 | [1188596651](https://www.openstreetmap.org/way/1188596651) | [1188596649](https://www.openstreetmap.org/way/1188596649) | 中野栄 | 4 / 4 | 6 | 178 |
| 23 | [1188596650](https://www.openstreetmap.org/way/1188596650) | [1188596648](https://www.openstreetmap.org/way/1188596648) | 中野栄 | 98 / 98 | 98 | 180 |
| 24 | [24370525](https://www.openstreetmap.org/way/24370525) | [776473599](https://www.openstreetmap.org/way/776473599) | 中野栄 | 1182 / 1181 | 4 | 180 |
| 25 | [103940819](https://www.openstreetmap.org/way/103940819) | [776474066](https://www.openstreetmap.org/way/776474066) | 多賀城 | 168 / 165 | 37 | 180 |
| 26 | [103747147](https://www.openstreetmap.org/way/103747147) | [776474067](https://www.openstreetmap.org/way/776474067) | 多賀城 | 77 / 77 | 78 | 180 |
| 27 | [103747148](https://www.openstreetmap.org/way/103747148) | [776475045](https://www.openstreetmap.org/way/776475045) | 多賀城 | 642 / 647 | 6 | 180 |
| 28 | [24370514](https://www.openstreetmap.org/way/24370514) | [776475044](https://www.openstreetmap.org/way/776475044) | 多賀城 | 914 / 908 | 5 | 180 |
| 29 | [103872823](https://www.openstreetmap.org/way/103872823) | [776475740](https://www.openstreetmap.org/way/776475740) | 下馬 | 706 / 703 | 106 | 0 |
| 30 | [24370543](https://www.openstreetmap.org/way/24370543) | [777948204](https://www.openstreetmap.org/way/777948204) | 下馬 | 310 / 382 | 5 | 180 |
| 31 | [776475739](https://www.openstreetmap.org/way/776475739) | [103872794](https://www.openstreetmap.org/way/103872794) | 下馬 | 17 / 17 | 4 | 1 |
| 32 | [24370569](https://www.openstreetmap.org/way/24370569) | [777952629](https://www.openstreetmap.org/way/777952629) | 西塩釜 | 667 / 657 | 25 | 180 |
| 33 | [103945635](https://www.openstreetmap.org/way/103945635) | [777949252](https://www.openstreetmap.org/way/777949252) | 西塩釜 | 17 / 18 | 18 | 177 |
| 34 | [103876049](https://www.openstreetmap.org/way/103876049) | [777952626](https://www.openstreetmap.org/way/777952626) | 西塩釜 | 139 / 141 | 5 | 180 |
| 35 | [24370526](https://www.openstreetmap.org/way/24370526) | [777952630](https://www.openstreetmap.org/way/777952630) | 本塩釜 | 352 / 352 | 28 | 180 |
| 36 | [24370522](https://www.openstreetmap.org/way/24370522) | [777953701](https://www.openstreetmap.org/way/777953701) | 本塩釜 | 89 / 90 | 4 | 0 |
| 37 | [777952628](https://www.openstreetmap.org/way/777952628) | [777952627](https://www.openstreetmap.org/way/777952627) | 本塩釜 | 1029 / 1027 | 25 | 180 |
| 38 | [103872851](https://www.openstreetmap.org/way/103872851) | [1267082102](https://www.openstreetmap.org/way/1267082102) | 東塩釜 | 17 / 16 | 3 | 3 |
| 39 | [1267082098](https://www.openstreetmap.org/way/1267082098) | [777955320](https://www.openstreetmap.org/way/777955320) | 東塩釜 | 23 / 24 | 13 | 3 |
| 40 | [1267082097](https://www.openstreetmap.org/way/1267082097) | [1267082101](https://www.openstreetmap.org/way/1267082101) | 東塩釜 | 19 / 19 | 0 | 3 |

## B. `passenger_lines=2` 未配对 — 17 个

以下 features 虽然标 passenger_lines=2 (复线段), 但算法未找到平行对端. 推测原因: OSM 上地下化区段以单 LineString 表达双线 (passenger_lines=2 标属性但不画两条几何). 请核对是否符合实际.

| # | osm_id | nearest_station | length (m) | name |
|---|---|---|---|---|
| 1 | [24370544](https://www.openstreetmap.org/way/24370544) | 仙台 | 458 | JR仙石線 |
| 2 | [24370555](https://www.openstreetmap.org/way/24370555) | 榴ヶ岡 | 861 | JR仙石線 |
| 3 | [775723282(1)](https://www.openstreetmap.org/way/775723282(1)) | 陸前原ノ町 | 3397 | JR仙石線 |
| 4 | [24370538](https://www.openstreetmap.org/way/24370538) | 宮城野原 | 1065 | JR仙石線 |
| 5 | [24370523](https://www.openstreetmap.org/way/24370523) | 宮城野原 | 753 | JR仙石線 |
| 6 | [24370551](https://www.openstreetmap.org/way/24370551) | 陸前原ノ町 | 263 | JR仙石線 |
| 7 | [776217961](https://www.openstreetmap.org/way/776217961) | 福田町 | 88 | JR仙石線 |
| 8 | [1231039753](https://www.openstreetmap.org/way/1231039753) | 福田町 | 4 | JR仙石線 |
| 9 | [1231039752](https://www.openstreetmap.org/way/1231039752) | 福田町 | 21 | JR仙石線 |
| 10 | [776217962](https://www.openstreetmap.org/way/776217962) | 福田町 | 218 | JR仙石線 |
| 11 | [776217967](https://www.openstreetmap.org/way/776217967) | 福田町 | 13 | JR仙石線 |
| 12 | [776217964](https://www.openstreetmap.org/way/776217964) | 福田町 | 65 | JR仙石線 |
| 13 | [776217966](https://www.openstreetmap.org/way/776217966) | 福田町 | 95 | JR仙石線 |
| 14 | [776473600](https://www.openstreetmap.org/way/776473600) | 多賀城 | 9 | JR仙石線 |
| 15 | [777949251](https://www.openstreetmap.org/way/777949251) | 下馬 | 226 | JR仙石線 |
| 16 | [777949250](https://www.openstreetmap.org/way/777949250) | 下馬 | 35 | JR仙石線 |
| 17 | [24370510](https://www.openstreetmap.org/way/24370510) | 東塩釜 | 316 | JR仙石線 |

## C. `passenger_lines` ≠ 2 (单线 / 渡线 / 接续段) — 120 个

非复线段; 含 93 个 passenger_lines=1 + 15 个 empty. service=crossover 的是渡线; 名字含"接続線"的是接续 Tohoku 主线.

| # | osm_id | nearest_station | length (m) | passenger_lines | service | name |
|---|---|---|---|---|---|---|
| 1 | [1320551300](https://www.openstreetmap.org/way/1320551300) | あおば通 | 35 | <empty> | - | - |
| 2 | [1320551299](https://www.openstreetmap.org/way/1320551299) | あおば通 | 35 | <empty> | - | - |
| 3 | [1083142704](https://www.openstreetmap.org/way/1083142704) | 宮城野原 | 42 | <empty> | - | - |
| 4 | [24370519](https://www.openstreetmap.org/way/24370519) | 福田町 | 85 | <empty> | - | JR仙石線 |
| 5 | [1231039755](https://www.openstreetmap.org/way/1231039755) | 福田町 | 7 | <empty> | - | JR仙石線 |
| 6 | [1231039754](https://www.openstreetmap.org/way/1231039754) | 福田町 | 19 | <empty> | - | JR仙石線 |
| 7 | [24370508](https://www.openstreetmap.org/way/24370508) | 福田町 | 219 | <empty> | - | JR仙石線 |
| 8 | [103770535](https://www.openstreetmap.org/way/103770535) | 福田町 | 13 | <empty> | - | JR仙石線 |
| 9 | [103770534](https://www.openstreetmap.org/way/103770534) | 福田町 | 65 | <empty> | - | JR仙石線 |
| 10 | [776217963](https://www.openstreetmap.org/way/776217963) | 福田町 | 95 | <empty> | - | JR仙石線 |
| 11 | [103940823](https://www.openstreetmap.org/way/103940823) | 多賀城 | 10 | <empty> | - | JR仙石線 |
| 12 | [776475738](https://www.openstreetmap.org/way/776475738) | 多賀城 | 375 | <empty> | siding | - |
| 13 | [103945637](https://www.openstreetmap.org/way/103945637) | 下馬 | 293 | <empty> | - | JR仙石線 |
| 14 | [103945634](https://www.openstreetmap.org/way/103945634) | 下馬 | 32 | <empty> | - | JR仙石線 |
| 15 | [810339112](https://www.openstreetmap.org/way/810339112) | 東塩釜 | 9 | <empty> | crossover | - |
| 16 | [810339111](https://www.openstreetmap.org/way/810339111) | 東塩釜 | 28 | <empty> | crossover | - |
| 17 | [810339113](https://www.openstreetmap.org/way/810339113) | 東塩釜 | 318 | <empty> | siding | - |
| 18 | [103872841](https://www.openstreetmap.org/way/103872841) | 東塩釜 | 109 | 1 | - | JR仙石線 |
| 19 | [103872779](https://www.openstreetmap.org/way/103872779) | 東塩釜 | 171 | 1 | - | JR仙石線 |
| 20 | [103946100](https://www.openstreetmap.org/way/103946100) | 東塩釜 | 379 | 1 | - | JR仙石線 |
| 21 | [363533634](https://www.openstreetmap.org/way/363533634) | 東塩釜 | 64 | 1 | - | JR仙石線 |
| 22 | [810339088](https://www.openstreetmap.org/way/810339088) | 陸前浜田 | 71 | 1 | - | JR仙石線 |
| 23 | [38846524](https://www.openstreetmap.org/way/38846524) | 東塩釜 | 301 | 1 | - | - |
| 24 | [810339089](https://www.openstreetmap.org/way/810339089) | 陸前浜田 | 9 | 1 | - | JR仙石線 |
| 25 | [103946102](https://www.openstreetmap.org/way/103946102) | 東塩釜 | 155 | 1 | - | JR仙石線 |
| 26 | [928259803](https://www.openstreetmap.org/way/928259803) | 東塩釜 | 44 | 1 | - | - |
| 27 | [928259802](https://www.openstreetmap.org/way/928259802) | 東塩釜 | 208 | 1 | - | - |
| 28 | [38828566](https://www.openstreetmap.org/way/38828566) | 陸前浜田 | 697 | 1 | - | JR仙石線 |
| 29 | [363533550](https://www.openstreetmap.org/way/363533550) | 陸前浜田 | 133 | 1 | - | JR仙石線 |
| 30 | [24370556](https://www.openstreetmap.org/way/24370556) | 陸前浜田 | 335 | 1 | - | JR仙石線 |
| 31 | [1255547751](https://www.openstreetmap.org/way/1255547751) | 陸前浜田 | 9 | 1 | - | JR仙石線 |
| 32 | [1255547750](https://www.openstreetmap.org/way/1255547750) | 陸前浜田 | 118 | 1 | - | JR仙石線 |
| 33 | [24370513](https://www.openstreetmap.org/way/24370513) | 陸前浜田 | 142 | 1 | - | JR仙石線 |
| 34 | [105611600](https://www.openstreetmap.org/way/105611600) | 陸前浜田 | 433 | 1 | - | JR仙石線 |
| 35 | [105611608](https://www.openstreetmap.org/way/105611608) | 陸前浜田 | 92 | 1 | - | JR仙石線 |
| 36 | [363530319](https://www.openstreetmap.org/way/363530319) | 陸前浜田 | 166 | 1 | - | JR仙石線 |
| 37 | [363529926](https://www.openstreetmap.org/way/363529926) | 陸前浜田 | 249 | 1 | - | JR仙石線 |
| 38 | [1253520776](https://www.openstreetmap.org/way/1253520776) | 陸前浜田 | 108 | 1 | - | JR仙石線 |
| 39 | [1253520777](https://www.openstreetmap.org/way/1253520777) | 陸前浜田 | 62 | 1 | - | JR仙石線 |
| 40 | [104502382](https://www.openstreetmap.org/way/104502382) | 陸前浜田 | 308 | 1 | - | JR仙石線 |
| 41 | [1253520779](https://www.openstreetmap.org/way/1253520779) | 松島海岸 | 91 | 1 | - | JR仙石線 |
| 42 | [104502385](https://www.openstreetmap.org/way/104502385) | 松島海岸 | 184 | 1 | - | JR仙石線 |
| 43 | [104501997](https://www.openstreetmap.org/way/104501997) | 松島海岸 | 396 | 1 | - | JR仙石線 |
| 44 | [363528792](https://www.openstreetmap.org/way/363528792) | 松島海岸 | 151 | 1 | - | JR仙石線 |
| 45 | [24370563](https://www.openstreetmap.org/way/24370563) | 松島海岸 | 147 | 1 | - | JR仙石線 |
| 46 | [351315046](https://www.openstreetmap.org/way/351315046) | 松島海岸 | 102 | <empty> | siding | JR仙石線 |
| 47 | [778809844](https://www.openstreetmap.org/way/778809844) | 松島海岸 | 105 | 1 | - | JR仙石線 |
| 48 | [104501991](https://www.openstreetmap.org/way/104501991) | 松島海岸 | 181 | 1 | - | JR仙石線 |
| 49 | [778809845](https://www.openstreetmap.org/way/778809845) | 松島海岸 | 29 | <empty> | siding | JR仙石線 |
| 50 | [778809846](https://www.openstreetmap.org/way/778809846) | 松島海岸 | 30 | 1 | - | JR仙石線 |
| 51 | [778809843](https://www.openstreetmap.org/way/778809843) | 松島海岸 | 71 | <empty> | siding | JR仙石線 |
| 52 | [778809842](https://www.openstreetmap.org/way/778809842) | 松島海岸 | 67 | 1 | - | JR仙石線 |
| 53 | [105609412](https://www.openstreetmap.org/way/105609412) | 松島海岸 | 357 | 1 | - | JR仙石線 |
| 54 | [375788114](https://www.openstreetmap.org/way/375788114) | 松島海岸 | 812 | 1 | - | JR仙石線 |
| 55 | [351315049](https://www.openstreetmap.org/way/351315049) | 松島海岸 | 341 | 1 | - | JR仙石線・東北本線接続線 |
| 56 | [105609380](https://www.openstreetmap.org/way/105609380) | 高城町 | 508 | 1 | - | JR仙石線 |
| 57 | [105609408](https://www.openstreetmap.org/way/105609408) | 高城町 | 101 | 1 | - | JR仙石線 |
| 58 | [104501286](https://www.openstreetmap.org/way/104501286) | 高城町 | 245 | 1 | - | JR仙石線 |
| 59 | [104501291](https://www.openstreetmap.org/way/104501291) | 高城町 | 24 | 1 | - | JR仙石線 |
| 60 | [24370567](https://www.openstreetmap.org/way/24370567) | 高城町 | 229 | 1 | - | JR仙石線 |
| 61 | [24370527](https://www.openstreetmap.org/way/24370527) | 高城町 | 180 | <empty> | siding | JR仙石線 |
| 62 | [666258656](https://www.openstreetmap.org/way/666258656) | 高城町 | 180 | 1 | - | JR仙石線 |
| 63 | [104501288](https://www.openstreetmap.org/way/104501288) | 高城町 | 348 | 1 | - | JR仙石線 |
| 64 | [104501283](https://www.openstreetmap.org/way/104501283) | 高城町 | 116 | 1 | - | JR仙石線 |
| 65 | [363526208](https://www.openstreetmap.org/way/363526208) | 高城町 | 639 | 1 | - | JR仙石線 |
| 66 | [667874382](https://www.openstreetmap.org/way/667874382) | 手樽 | 14 | 1 | - | JR仙石線 |
| 67 | [363526209](https://www.openstreetmap.org/way/363526209) | 手樽 | 359 | 1 | - | JR仙石線 |
| 68 | [363526207](https://www.openstreetmap.org/way/363526207) | 手樽 | 6 | 1 | - | JR仙石線 |
| 69 | [24370552](https://www.openstreetmap.org/way/24370552) | 手樽 | 216 | 1 | - | JR仙石線 |
| 70 | [110197613](https://www.openstreetmap.org/way/110197613) | 手樽 | 403 | 1 | - | JR仙石線 |
| 71 | [110197573](https://www.openstreetmap.org/way/110197573) | 手樽 | 96 | 1 | - | JR仙石線 |
| 72 | [24370509](https://www.openstreetmap.org/way/24370509) | 陸前富山 | 785 | 1 | - | JR仙石線 |
| 73 | [24370532](https://www.openstreetmap.org/way/24370532) | 陸前富山 | 1994 | 1 | - | JR仙石線 |
| 74 | [778816623](https://www.openstreetmap.org/way/778816623) | 陸前大塚 | 229 | 1 | siding | JR仙石線 |
| 75 | [1384433012](https://www.openstreetmap.org/way/1384433012) | 陸前大塚 | 228 | 1 | - | JR仙石線 |
| 76 | [1445974890](https://www.openstreetmap.org/way/1445974890) | 陸前大塚 | 109 | 1 | - | JR仙石線 |
| 77 | [1445974891](https://www.openstreetmap.org/way/1445974891) | 陸前大塚 | 6 | 1 | - | JR仙石線 |
| 78 | [1384433011](https://www.openstreetmap.org/way/1384433011) | 陸前大塚 | 324 | 1 | - | JR仙石線 |
| 79 | [350162056](https://www.openstreetmap.org/way/350162056) | 東名 | 386 | 1 | - | JR仙石線 |
| 80 | [1049799770](https://www.openstreetmap.org/way/1049799770) | 東名 | 586 | 1 | - | JR仙石線 |
| 81 | [1049799771](https://www.openstreetmap.org/way/1049799771) | 東名 | 52 | 1 | - | JR仙石線 |
| 82 | [363465320](https://www.openstreetmap.org/way/363465320) | 東名 | 680 | 1 | - | JR仙石線 |
| 83 | [363465321](https://www.openstreetmap.org/way/363465321) | 野蒜 | 22 | 1 | - | JR仙石線 |
| 84 | [1384433010](https://www.openstreetmap.org/way/1384433010) | 野蒜 | 233 | 1 | - | JR仙石線 |
| 85 | [362336446](https://www.openstreetmap.org/way/362336446) | 野蒜 | 277 | 1 | siding | JR仙石線 |
| 86 | [1384433009](https://www.openstreetmap.org/way/1384433009) | 野蒜 | 276 | 1 | - | JR仙石線 |
| 87 | [350162055](https://www.openstreetmap.org/way/350162055) | 野蒜 | 269 | 1 | - | JR仙石線 |
| 88 | [103678325](https://www.openstreetmap.org/way/103678325) | 野蒜 | 1610 | 1 | - | JR仙石線 |
| 89 | [24370511](https://www.openstreetmap.org/way/24370511) | 陸前小野 | 448 | 1 | - | JR仙石線 |
| 90 | [780912266](https://www.openstreetmap.org/way/780912266) | 陸前小野 | 238 | <empty> | siding | - |
| 91 | [832296455](https://www.openstreetmap.org/way/832296455) | 陸前小野 | 239 | 1 | - | JR仙石線 |
| 92 | [24370549](https://www.openstreetmap.org/way/24370549) | 鹿妻 | 1434 | 1 | - | JR仙石線 |
| 93 | [24370533](https://www.openstreetmap.org/way/24370533) | 鹿妻 | 2504 | 1 | - | JR仙石線 |
| 94 | [832296453](https://www.openstreetmap.org/way/832296453) | 矢本 | 356 | 1 | - | JR仙石線 |
| 95 | [832296454](https://www.openstreetmap.org/way/832296454) | 矢本 | 355 | 1 | - | JR仙石線 |
| 96 | [24370570](https://www.openstreetmap.org/way/24370570) | 東矢本 | 1138 | 1 | - | JR仙石線 |
| 97 | [24370558](https://www.openstreetmap.org/way/24370558) | 東矢本 | 849 | 1 | - | JR仙石線 |
| 98 | [103762016](https://www.openstreetmap.org/way/103762016) | 陸前赤井 | 69 | 1 | - | JR仙石線 |
| 99 | [24370539](https://www.openstreetmap.org/way/24370539) | 陸前赤井 | 567 | 1 | - | JR仙石線 |
| 100 | [780913602](https://www.openstreetmap.org/way/780913602) | 陸前赤井 | 229 | <empty> | siding | - |
| 101 | [832296452](https://www.openstreetmap.org/way/832296452) | 陸前赤井 | 230 | 1 | - | JR仙石線 |
| 102 | [1451612507](https://www.openstreetmap.org/way/1451612507) | 陸前赤井 | 533 | 1 | - | JR仙石線 |
| 103 | [1451612508](https://www.openstreetmap.org/way/1451612508) | 陸前赤井 | 15 | 1 | - | JR仙石線 |
| 104 | [562517669](https://www.openstreetmap.org/way/562517669) | 石巻あゆみ野 | 2079 | 1 | - | JR仙石線 |
| 105 | [209463222](https://www.openstreetmap.org/way/209463222) | 蛇田 | 923 | 1 | - | JR仙石線 |
| 106 | [209463221](https://www.openstreetmap.org/way/209463221) | 蛇田 | 63 | 1 | - | JR仙石線 |
| 107 | [598378609](https://www.openstreetmap.org/way/598378609) | 蛇田 | 11 | 1 | - | JR仙石線 |
| 108 | [598378610](https://www.openstreetmap.org/way/598378610) | 蛇田 | 14 | 1 | - | JR仙石線 |
| 109 | [598378597](https://www.openstreetmap.org/way/598378597) | 陸前山下 | 533 | 1 | - | JR仙石線 |
| 110 | [832296451](https://www.openstreetmap.org/way/832296451) | 陸前山下 | 235 | 1 | siding | JR仙石線 |
| 111 | [832296305](https://www.openstreetmap.org/way/832296305) | 陸前山下 | 234 | 1 | - | JR仙石線 |
| 112 | [832296450](https://www.openstreetmap.org/way/832296450) | 陸前山下 | 226 | 1 | - | JR仙石線 |
| 113 | [598378909](https://www.openstreetmap.org/way/598378909) | 陸前山下 | 5 | 1 | - | JR仙石線 |
| 114 | [24370557](https://www.openstreetmap.org/way/24370557) | 陸前山下 | 87 | 1 | - | JR仙石線 |
| 115 | [104497249](https://www.openstreetmap.org/way/104497249) | 陸前山下 | 19 | 1 | - | JR仙石線 |
| 116 | [104497252](https://www.openstreetmap.org/way/104497252) | 陸前山下 | 284 | 1 | - | JR仙石線 |
| 117 | [882389023](https://www.openstreetmap.org/way/882389023) | 石巻 | 275 | 1 | - | JR仙石線 |
| 118 | [351315101](https://www.openstreetmap.org/way/351315101) | 石巻 | 44 | <empty> | crossover | - |
| 119 | [206368689](https://www.openstreetmap.org/way/206368689) | 石巻 | 274 | 1 | - | JR仙石線 |
| 120 | [351315047](https://www.openstreetmap.org/way/351315047) | 石巻 | 188 | 1 | - | JR仙石線 |

## 核对要点

- **A 类 (paired)**: 同一行的两个 OSM way 在 OSM 网站上应当看上去是 "同一区段的两条平行轨道". bearΔ 偏离 180° (例如 < 170° 或 > 190°) 的可能是错对.
- **B 类 (unpaired)**: 数据/算法盲区. 若你确认该 way 在 OSM 上是 "单 LineString 表达双线 (隧道段常见)", 我们后续按 `directionRole=bidirectional` 处理. 若该 way 实际是 "复线段的一半但配对算法选错了对端", 请指出应当配对到哪条.
- **C 类**: 主要是单线段 + 3 条渡线 (service=crossover) + 1 条接续线 (name含"接続線"). 不需要配对.