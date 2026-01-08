# RailLOOP - 個人向鐵道旅行手帳

Presented & Maintained by [@OsakaLOOP](https://github.com/OsakaLOOP)

> **DON'T PANIC.**

## 1. 用戶指南 (The Guide)

《[銀河電車指南](https://zh.wikipedia.org/zh-tw/%E9%93%B6%E6%B2%B3%E7%B3%BB%E6%BC%AB%E6%B8%B8%E6%8C%87%E5%8D%97)》對於 **RailLOOP** 的定義如下：這是一個幾乎完全由「白嫖」(Freeloader) 精神驅動的、基於 [Serverless](https://en.wikipedia.org/wiki/Serverless_computing) / [Edge-function](https://en.wikipedia.org/wiki/Edge_computing) 架構的，富有忠實、多樣以及 **泛二 (ACGN) 精神** 的旅鐵記錄裝置。它看起來像是一個複雜的工程奇蹟，但實際上它大部分由 [WD-40™](https://www.wd40.com)、祈禱和免費額度 (真的很多，但是需要提防系統誤判和腳本小子) 維繫。

如果你是一個剛剛被傳送至此的星際搭車客 (或者不受歡迎的 [JR](https://www.jr-odekake.net) 鐵道迷)，請務必遵循以下生存守則：

- **記錄行程**: 在首頁點擊「記錄新行程」，支持公司/線路選擇或自動規劃。
- **地圖模式**: 可視化查看您的足跡，支持上傳 GeoJSON 地圖文件。
- **GitHub 掛件**: 綁定 GitHub 帳號後，可生成動態 SVG 卡片展示在您的個人主頁。

### 存在與持久性 (The Persistence)
- **關於 Bypass 的警告**：請務必定時備份本地存儲，或者至少登陸帳號，綁定 [GitHub](https://github.com) 就更好了 (雖然這和存儲沒有更多關係，但是可以用於 Socializing)。雖然我們在邏輯上基於「線路/車站名稱和 ID」進行了深度綁定，擁有 **12 個 9** 的理論數據可靠性 (這甚至高於 CDN 的承諾)。這意味著，即便 [沃貢人](https://hitchhikers.fandom.com/wiki/Vogons) (或者 [JR 北海道](https://www.jrhokkaido.co.jp)) 為了建設一條新的新幹線聯絡線 (這不太可能) 而決定殘酷地廢線某些物理設施 (這絕對可能)，只要車站 ID 還在，你的記錄就不會隨版本更迭而失效。但如果你清空了緩存且沒綁定帳號，數據就會像被拋入 [全視角漩渦](https://hitchhikers.fandom.com/wiki/Total_Perspective_Vortex) 一樣消失。

### 可用性之哲學 (The Probability)
- **12 個 9 的真相**：請注意，這個高得離譜的可用性數字屬於我們白嫖的 CDN 服務商 ([EdgeOne](https://cloud.tencent.com/product/teo))，而非本服務的代碼質量。這意味著，伺服器幾乎永不宕機，但**並不**保證運行在上面的代碼邏輯不會像一台 [無限非概率驅動引擎](https://hitchhikers.fandom.com/wiki/Infinite_Improbability_Drive) (Infinite Improbability Drive) 一樣，突然把你的路徑規劃變成一個 200 km/h 達速運行的綠色垃圾桶。

### 存在主義圖床 (Image Availability)
- 正如指南中關於「[抹茶](https://en.wikipedia.org/wiki/Matcha)」的條目經常讓飛船電腦崩潰一樣，本服務**不提供圖床**。
- 如果你想展示你與新幹線 [黃醫生](https://zh.wikipedia.org/zh-tw/%E6%96%B0%E5%B9%B9%E7%B7%9A%E9%86%AB%E7%94%9F%E9%BB%83) 的自拍 (沒人關心前者)，請**自己想辦法** ([S3](https://aws.amazon.com/s3)、[R2](https://www.cloudflare.com/developer-platform/r2)、或者某種古老的微博外鏈技術)，然後手動粘貼 URL。這被視為一種對核心玩家的篩選機制 —— 只有真正懂得如何在數字荒原生存的人，才配擁有思想、尊嚴、記錄和圖片。

### 社交身分象徵 (Badges)
- 我們開發了 **GitHub Readme Badge**。這是一個動態 [SVG](https://www.w3.org/Graphics/SVG/)，旨在向其他碳基生物炫耀你在這個星球的鐵軌上消耗了多少不可再生的時間，或者找到類似的沒有任何生殖希望的同類 ([偽娘 / 男の娘](https://zh.moegirl.org.cn/%E4%BC%AA%E5%A8%98)) 們。

---

## 2. 免責協議 (The Bureaucracy)

在使用本服務前，請知曉以下條款。這些條款像銀河系行政規劃圖一樣不可更改，但通常被放在沒人看的地下室裡。

我們收集以下信息，僅用於提供對應服務：
- 用戶名與加密後的密碼。
- 您主動記錄的行程數據與圖釘信息。
- 通過 GitHub 登入時的公開資料（頭像、暱稱）。

### 與不可名狀的 py 交易
本服務的架構站在無數巨人的肩膀上，以及一些處於灰色地帶的努力：
- **基礎設施**：感謝 **[EdgeOne](https://cloud.tencent.com/product/teo)** 提供了 Serverless 計算節點和 Pages CDN。
- **特別鳴謝**：**[閑魚](https://2.taobao.com)**。正是在這個混亂而有效率的市場裡，我們以 10r 的低廉價格搞到了一個伺服器 Token，成功繞過了家用寬帶備案那如同沃貢官僚主義般的繁瑣限制，讓早期的原型機得以在物理世界呼吸。雖然後來為了穩定遷移到了 Pages，但這筆交易將永載史冊。
- **數據源**：**[國土交通省 (MLIT)](https://www.mlit.go.jp)**、**[ODPT](https://www.odpt.org)**、**[Ekidata](https://ekidata.jp)** 和 **[鉄道駅LOD](https://uedayou.net/jrslod/)**。(見開源協議)

### 關於「山手線」的拓撲悖論 (The Yamanote Paradox)
- **現象**：你可能會發現，地圖上的 **[山手線](https://zh.wikipedia.org/zh-tw/%E5%B1%B1%E6%89%8B%E7%B7%9A)** 並不是一個閉合的環，而是一個從品川經新宿到田端的「C」字形。
- **解釋**：請不要向我們提交 Bug 報告。在國土交通省 (以及絕大多數嚴格的 [GIS](https://www.esri.com/en-us/what-is-gis/overview) 數據庫) 的法律定義裡，**「山手線」作為一個法律實體，確實只是那個「C」字形**。剩下的部分分別借用了 [東海道本線](https://zh.wikipedia.org/zh-tw/%E6%9D%B1%E6%B5%B7%E9%81%93%E6%9C%AC%E7%B7%9A) 和 [東北本線](https://zh.wikipedia.org/zh-tw/%E6%9D%B1%E5%8C%97%E6%9C%AC%E7%B7%9A) 的軌道。
- **結論**：如果目前的前端渲染看起來像個斷開的圓環，那不是 Bug，那是對官僚主義法律現實的尊重 (當然，也可能是因為我們的環線與上下行分離邏輯還沒寫好，導致那 5% 的幾何展示有瑕疵)。

### 隱私性 (Privacy)
- **盒子模型**：我們採用 [KV](https://en.wikipedia.org/wiki/Key%E2%80%93value_database) 存儲，一切用戶信息的查詢基於一個簡單的 Hash Key (嚴格講是兩個)。
- **警告**：這就像是你把日記放在了一個沒有鎖、但藏在銀河系某個角落的箱子裡。理論上沒人找得到，但本服務**不是**為了存儲 [NERV](https://evangelion.fandom.com/wiki/NERV) 機密設計的。**嚴禁上傳家庭住址、真實姓名或任何你不想讓沃貢 Captain (或者帽子叔叔) 看到的敏感信息，否則你可能被帽子叔叔上門唸詩而亡。**

---

## 3. todo 和版本歷史 (The Prophecies)

### 版本歷史 (Changelog)

- **v0.10**: 純前端 "Vibe Coding"。卡到爆，勉強能用。繪製正確率：**0%**。
- **v0.20**: 優化了線路查找和規劃，打磨界面細節。完全重寫渲染和規劃邏輯 (Again)，增加 CDN 自動導入。
- **v0.30 (Current)**: 增加了基於 KV 存儲的用戶帳戶體系，集成 GitHub 登入。

---

以下是我們試圖將這個混亂而擁擠的宇宙理出頭緒的計劃，按「只要不做就會錯」到「這簡直是魔法」的順序排列：

### Phase 1: 基礎生存 (Earning Rice for Fufu)
1.  **Badge 系統大重構**：生成獨立的 Hash 列表用於公開展示，不再強迫用戶暴露自己的鑑權 Key。同時支持生成不同版本的 Badge，以滿足不同星球物種的審美，或者你想保存每一次無意義的出入國記錄。
2.  **數據庫大清洗**：修復線路數據庫。雖然你可以手動選擇或者導入自己的 [GeoJSON](https://geojson.org)，但我們為了大多數用戶需要手動把那些在 GIS 定義裡斷開的線路 (比如那個山手線 C 字) 在視覺上焊起來，畢竟人類喜歡圓的東西。
3.  **Ekidata 大引入**：引入換乘數據，讓路徑規劃看起來不那麼像是在擲骰子，或者 [西園寺](https://www.youtube.com/@saionjichannel) 和 [スーツ旅行](https://www.youtube.com/@SuitTravel) 的 **大回り乘車罰遊戲**。
4.  **資源大開發**：將引用的 CDN 線路圖標本地化，防止上游服務商因為我們白嫖太多而切斷圖片供應，或者被牆。

### Phase 2: 引擎升級 (Improving the Drive)
5.  **性能提升**：目前的地圖底圖渲染會讓你的 CPU 風扇發出像即將起飛的航天飛機 (永遠看不到了，所以或許 [SLS](https://www.nasa.gov/exploration/systems/sls/index.html)) 一樣的聲音。我們將把 GeoJSON **底圖化**，減少大量 DOM/SVG 節點的活動渲染壓力。當然更急需的是不要每次 [React](https://react.dev) 事件都重新計算 (已經改進了，但還不夠好)。
6.  **算法優化**：試圖將路徑規劃的成功率從 50% 提升到更體面的數值，至少不能總是建議用戶虛空換乘，或者浪費 [途中下車](https://www.jreast.co.jp/kippu/1103.html) 機會，可以的話還會引入票價和時刻表。

### Phase 3: 核心重鑄 (Reframe and Refractory)
7.  **架構躍遷**：引入正規的圖床和 [SQL](https://en.wikipedia.org/wiki/SQL) 數據庫，拋棄現在的 KV 縫合怪方案。這就像從用算盤計算直接升級到 [GTX® 5090](https://www.nvidia.com)。
8.  **隱私護盾**：綜合提升隱私防護，不再僅僅依賴「沒人猜得到你的 Hash」這種概率學防禦，並且使用 [JWT](https://jwt.io) 保護你的 URL。

### Phase 4: 終極答案 (Life, the Universe, and Everything)
9.  **外部 API 拓展**：打破數據孤島。
10. **上下文感知**：結合當前播放的音樂或地理位置自動多維記錄。
11. **巡禮系統 (パレード)**：這才是本服務的終極形態。從單純的「打點」升級為以現地活動 (Live、場販、聖地巡禮、[終末旅行](https://zh.wikipedia.org/zh-tw/%E5%B0%91%E5%A5%B3%E7%B5%82%E6%9C%AB%E6%97%85%E8%A1%8C)) 為核心的記錄系統。(為了方便 **夜鹿廚**，可能還要引入瑞典斯德哥爾摩、阿姆斯特丹)。
12. **視覺盛宴**：車票渲染、站台 [LED](https://en.wikipedia.org/wiki/Dot-matrix_display)、回憶手帳頁面展示。防止你忘了拍照 (或者被站務阻止)，讓你的回憶看起來比實際發生的更美好 (真的)。
13. **站娘 (Eki-musume) 設計**：現向全社會公開徵集，地點還是在那個地下室。或者等我精通板繪和 [Live2D](https://www.live2d.com)。

*Sit down and Enjoy the Tabitetsu travel. (如果你有美妙的指定席座位，否則，當我沒說)*\
*P.S. 如果你們當中有外星人、未來人、超能力者，請勿遵守本指南。*

---

## License & Credits

### Open Source License
Distributed under the **MIT License**. See `LICENSE` for more information.

### Acknowledgements
本服務依照相關數據源的使用條款引用並展示數據。二次開發或分發時請務必遵守以下協議：

- **Public Transportation Data**: Powered by **[ODPT](https://www.odpt.org)** (Open Data Public Transportation Center).
    - *License*: [ODPT Terms of Use](https://www.odpt.org/terms/) (Compatible with CC BY 4.0).
- **Geospatial Data**: Sourced from **[MLIT](https://www.mlit.go.jp/kokudoseisaku/gis/)** (Ministry of Land, Infrastructure, Transport and Tourism) - National Land Numerical Information.
    - *License*: [MLIT Standard Terms of Use](https://www.mlit.go.jp/kokudoseisaku/gis/terms.html) (CC BY 4.0 compatible).
- **Station Data**: **[Ekidata.jp](https://ekidata.jp)**.
- **Linked Open Data**: **[LOD Challenge](https://uedayou.net/jrslod/)** datasets.

> *Note: While RailLOOP itself is open source, the map data and railway icons cached locally are subject to their original copyright holders' terms.*