# RailLOOP - 個人向け旅び鉄手帳

Presented & Maintained by [@OsakaLOOP](https://github.com/OsakaLOOP)

> **DON'T PANIC.**

### 1. ユーザーガイド (The Guide)

『[銀河鉄道ファン・ガイド](https://ja.wikipedia.org/wiki/%E9%8A%80%E6%B2%B3%E3%83%92%E3%83%83%E3%83%81%E3%83%8F%E3%82%A4%E3%82%AF%E3%83%BB%E3%82%AC%E3%82%A4%E3%83%89)』における **RailLOOP** の定義は以下の通りです：これはほぼ完全に「タダ乗り」(Freeloader) 精神によって駆動され、[Serverless](https://en.wikipedia.org/wiki/Serverless_computing) / [Edge-function](https://en.wikipedia.org/wiki/Edge_computing) アーキテクチャに基づいた、忠実かつ多様で、**汎オタク精神** に溢れた旅鉄記録装置です。それは複雑な工学的奇跡のように見えますが、実際にはその大部分が [WD-40™](https://www.wd40.com)、祈り、そして無料利用枠 (本当に多いですが、システムの誤検知とスクリプトキディには警戒が必要です) によって維持されています。

- **旅程を記録**: ホーム画面で「新しい旅程を記録」をクリック。鉄道事業者/路線の選択、または自動計画をサポート。
- **マップモード**: 足跡を可視化。GeoJSON 地図ファイルのアップロードをサポート。
- **GitHub Widget**: GitHub アカウント連携後、個人プロフィールに表示可能な動的 SVG カードを生成。

もしあなたがここに転送されてきたばかりの星間ヒッチハイカー (あるいは歓迎されてない「**[厄介鉄](https://dic.nicovideo.jp/a/%E5%8E%84%E4%BB%8B%E9%89%84)**」と呼ばれる JR 鉄道ファン) なら、以下の生存規則を必ず遵守してください：

- **実存と永続性 (The Persistence)**
    - **Bypass に関する警告**: 必ずローカルストレージの定期バックアップを行うか、少なくともアカウントにログインし、[GitHub](https://github.com) と連携することをお勧めします (ストレージとはあまり関係ありませんが、Socializing には役立ちます)。論理的には「路線/駅名と ID」に基づいて深くバインドされており、**12 ナイン (99.9999999999%)** という理論上のデータ信頼性を持っています (これは CDN の保証すら上回ります)。つまり、たとえ [ヴォゴン人](https://hitchhikers.fandom.com/wiki/Vogons) (あるいは [JR 北海道](https://www.jrhokkaido.co.jp)) が新しい新幹線連絡線を建設するために (ありえませんが)、特定の物理的施設を残酷にも廃線にすることを決定したとしても (これは絶対にありえます)、駅 ID が存在する限り、あなたの記録がバージョン更新によって無効になることはありません。しかし、キャッシュをクリアし、かつアカウント連携をしていない場合、データはかつての地球 (曖昧さ回避: [The Earth - Supercomputer](https://hitchhikers.fandom.com/wiki/Earth), not [The Earth - Planet](https://en.wikipedia.org/wiki/Earth)) と同様に消失します。

- **可用性の哲学 (The Probability)**
    - **12 ナインの真実**: ご注意ください。この馬鹿げた高い可用性の数値は、私たちがタダ乗りしている CDN プロバイダー ([EdgeOne](https://cloud.tencent.com/product/teo)) のものであり、本サービスのコード品質のものではありません。サーバーがダウンすることはほぼありませんが、その上で動作するコードロジックが [無限不可能性ドライブ](https://hitchhikers.fandom.com/wiki/Infinite_Improbability_Drive) (Infinite Improbability Drive) のように振る舞い、あなたの経路探索を突如として時速 200km で疾走する緑色のゴミ箱に変えてしまわないという保証は **ありません**。

- **実存主義的画像ホスティング (Image Availability)**
    - ガイドの「[抹茶](https://en.wikipedia.org/wiki/Matcha)」の項目が頻繁に宇宙船のコンピュータをクラッシュさせるのと同様に、本サービスは **画像ホスティングを提供しません**。
    - もしあなたが新幹線の [ドクターイエロー](https://ja.wikipedia.org/wiki/%E3%83%89%E3%82%AF%E3%82%BF%E3%83%BC%E3%82%A4%E3%82%A8%E3%83%AD%E3%83%BC) との自撮り (前者を気にする人はいません) を表示したいなら、**自分でなんとかしてください** ([S3](https://aws.amazon.com/s3)、[R2](https://www.cloudflare.com/developer-platform/r2)、あるいは何らかの古の Weibo 外的リンク技術など)。そして手動で URL を貼り付けてください。これはコアなプレイヤーに対する選別メカニズムと見なされます —— デジタル荒野での生存方法を真に理解している者だけが、思想、尊厳、記録、そして画像を持つに値するのです。

- **社会的ステータスの象徴 (Badges)**
    - そのため、 **GitHub Readme Badge** を開発しました。これは動的な [SVG](https://www.w3.org/Graphics/SVG/) であり、あなたがこの惑星のレールの上でどれだけの再生不可能な時間を浪費したかを他の炭素生命体に自慢するため、あるいは生殖の希望が全くない同様の同類 ([男の娘](https://dic.pixiv.net/a/%E7%94%B7%E3%81%AE%E5%A8%98)) を見つけるためのものです。

---

### 2. 免責事項 (The Bureaucracy)

本サービスを利用する前に、以下の条項を承知しておいてください。これらの条項は銀河バイパス建設予定図のように変更不可能ですが、通常は誰も見掛けてない地下室に置かれています。

当サービスは、以下の情報をサービスの提供のみを目的として収集します：    
- ユーザー名と暗号化されたパスワード。
- ユーザーが能動的に記録した旅程データとピン情報。
- GitHub ログイン時の公開プロフィール (アバター、ニックネーム)。

- **名状しがたい裏取引**
    本サービスのアーキテクチャは無数の巨人の肩の上、そしていくつかのグレーゾーンの努力の上に成り立っています：
    - **インフラ**: Serverless 計算ノードと Pages CDN を提供してくれた **[EdgeOne](https://cloud.tencent.com/product/teo)** に感謝します。
    - **Special Thanks**: **[閑魚 (Xianyu)](https://2.taobao.com)**。この混沌としつつも効率的な市場で、私たちは 10 人民元という低価格でサーバー Token を入手し、ヴォゴンの官僚主義のような家庭用ブロードバンド登録の煩雑な制限を回避し、初期のプロトタイプを物理世界で呼吸させることに成功しました。後に安定性のために Pages に移行しましたが、この取引は歴史に刻まれるでしょう。
    - **データソース**: **[国土交通省 (MLIT)](https://www.mlit.go.jp)**、**[ODPT](https://www.odpt.org)**、**[駅データ.jp](https://ekidata.jp)**、そして **[鉄道駅LOD](https://uedayou.net/jrslod/)**。(オープンソースライセンス参照)

- **「山手線」のトポロジーパラドックス (The Yamanote Paradox)**
    - **現象**: 地図上の **[山手線](https://ja.wikipedia.org/wiki/%E5%B1%B1%E6%89%8B%E7%B7%9A)** が閉じた環状線ではなく、品川から新宿を経由して田端に至る「C」の字形であることに気づくかもしれません。
    - **説明**: バグ報告を送らないでください。国土交通省 (および大多数の厳格な [GIS](https://www.esri.com/en-us/what-is-gis/overview) データベース) の法的定義において、**法的主体としての「山手線」は確かにその「C」の字形だけなのです**。残りの部分はそれぞれ [東海道本線](https://ja.wikipedia.org/wiki/%E6%9D%B1%E6%B5%B7%E9%81%93%E6%9C%AC%E7%B7%9A) と [東北本線](https://ja.wikipedia.org/wiki/%E6%9D%B1%E5%8C%97%E6%9C%AC%E7%B7%9A) の線路を借りています。
    - **結論**: もし現在のフロントエンドの描画が途切れたリングのように見えたとしても、それはバグではなく、官僚主義的な法的現実への尊重です (もちろん、私たちの環状線と内外回りの分離ロジックがまだうまく書けていないため、その 5% の幾何学的表示に欠陥があるせいかもしれませんが)。

- **プライバシー (Privacy)**
    - **ボックスモデル**: 私たちは [KV](https://en.wikipedia.org/wiki/Key%E2%80%93value_database) ストレージを採用しており、すべてのユーザー情報の照会は単純な Hash Key (厳密には2つ) に基づいています。
    - **警告**: これは鍵のない箱に日記を入れ、銀河の片隅に隠しておくようなものです。理論的には誰も見つけられませんが、本サービスは [NERV](https://evangelion.fandom.com/wiki/NERV) の機密を保存するために設計されたものでは **ありません**。**自宅の住所、本名、あるいはヴォゴン船長 (またはお巡りさん) に見られたくないような機密情報は絶対にアップロードしないでください。さもなくば、お巡りさんに詩を朗読されて死ぬことになるかもしれません。**

---

### 3. Todo とバージョン履歴 (The Prophecies)

#### Changelog

- **v0.10**: 純フロントエンド "Vibe Coding"。重すぎて爆発寸前、かろうじて動作。描画正確率：**0%**。
- **v0.20**: 路線検索と計画を最適化、UI の細部を研磨。レンダリングと計画ロジックを完全書き直し (再)。CDN 自動インポートを追加。
- **v0.30 (Current)**: KV ストレージベースのユーザーアカウント体系を追加。GitHub 連携を実装。

---

以下は、この混沌として混雑した宇宙を整理するための私たちの計画であり、「やらなければ間違い」から「これはまさに魔法だ」の順に並べられています：

#### Phase 1: 基礎生存 (Earning Rice for Fufu)
1.  **Badge システムの大規模リファクタリング**: 公開表示用の独立した Hash リストを生成し、ユーザーに認証 Key を晒すことを強制しないようにします。同時に、異なる惑星の種族の美的感覚を満たすため、あるいは無意味な出入国記録をすべて保存したい人のために、異なるバージョンの Badge 生成をサポートします。
2.  **データベースの大掃除**: 路線データベースの修復。手動で独自の [GeoJSON](https://geojson.org) を選択またはインポートすることもできますが、大多数のユーザーのために、GIS 定義で途切れている路線 (例の山手線の C の字など) を視覚的に溶接する必要があります。結局のところ、人類は丸いものが好きなのです。
3.  **駅データの導入**: 乗換データを導入し、経路探索がサイコロ振りのように見えないようにします。あるいは [西園寺](https://www.youtube.com/@saionjichannel) や [スーツ旅行](https://www.youtube.com/@SuitTravel) の **大回り乗車罰ゲーム** (Omawari Penalty Game) のようにならないように。
4.  **リソース開発**: 引用している CDN の路線アイコンをローカライズし、タダ乗りのしすぎで上流のプロバイダーに画像の供給を断たれたり、ファイアウォールに遮断されたりするのを防ぎます。

#### Phase 2: エンジンのアップグレード (Improving the Drive)
5.  **パフォーマンス向上**: 現在の地図ベースのレンダリングは、あなたの CPU ファンを離陸直前のスペースシャトル (二度と見られないので、あるいは [SLS](https://www.nasa.gov/exploration/systems/sls/index.html)) のような音にさせます。GeoJSON を **Base Map 化** し、大量の DOM/SVG ノードのアクティブなレンダリング負荷を軽減します。もちろん、より緊急なのは [React](https://react.dev) イベントごとの再計算を防ぐことです (改善されましたが、まだ十分ではありません)。
6.  **アルゴリズム最適化**: 経路探索の成功率を 50% からよりまともな数値に引き上げ、少なくともユーザーに虚空での乗り換えを提案したり、[途中下車](https://www.jreast.co.jp/kippu/1103.html) の機会を無駄にさせたりしないようにします。可能であれば運賃と時刻表も導入します。

#### Phase 3: コアの再構築 (Reframe and Refractory)
7.  **アーキテクチャの飛躍**: 正規の画像ホスティングと [SQL](https://en.wikipedia.org/wiki/SQL) データベースを導入し、現在の KV つぎはぎモンスター案を捨てます。これはそろばん計算から [GTX® 5090](https://www.nvidia.com) へ直接アップグレードするようなものです。
8.  **プライバシーシールド**: 「誰もあなたの Hash を推測できない」という確率論的防御のみに頼るのではなく、プライバシー保護を包括的に強化し、[JWT](https://jwt.io) を使用して URL を保護します。

#### Phase 4: 生命、宇宙、そして万物 (Life, the Universe, and Everything)
9.  **外部 API 拡張**: データのサイロ化を打破します。
10. **コンテキスト認識**: 再生中の音楽や現在位置を組み合わせて、多次元的に自動記録します。
11. **巡礼システム (パレード)**: これこそが本サービスの最終形態です。単純な「チェックイン」から、現地活動 (ライブ、物販、聖地巡礼、[少女終末旅行](https://ja.wikipedia.org/wiki/%E5%B0%91%E5%A5%B3%E7%B5%82%E6%9C%AB%E6%97%85%E8%A1%8C)) を核とした記録システムへとアップグレードします。( **ヨルシカ勢** の便宜を図るため、スウェーデンのストックホルムやアムステルダムも導入する必要があるかもしれません)。
12. **視覚の饗宴**: 切符のレンダリング、駅の [LED](https://en.wikipedia.org/wiki/Dot-matrix_display) 風再生、思い出の手帳ページ表示。写真を撮り忘れる (あるいは駅員に止められる) のを防ぎ、あなたの思い出を実際に起きたことよりも美しく見せます (本当に)。
13. **駅娘 (Eki-musume) デザイン**: 現在、全社会に向けて公募中です。場所は例の地下室です。あるいは私がデジタルイラストと [Live2D](https://www.live2d.com) をマスターするまでお待ちください。

*Sit down and Enjoy the Tabitetsu travel. (もしあなたが素晴らしい指定席券を持っていればの話ですが。そうでなければ、忘れてください)*
*P.S. もしあなたの中に宇宙人、未来人、超能力者がいたら、このガイドには従わないでください。*

---

### License & Credits

#### Open Source License
Distributed under the **MIT License**. See `LICENSE` for more information.

#### Acknowledgements
本サービスは関連データソースの利用規約に従ってデータを引用・表示しています。二次開発または配布の際は、以下の規約を必ず遵守してください：

- **Public Transportation Data**: Powered by **[ODPT](https://www.odpt.org)** (Open Data Public Transportation Center).
    - *License*: [ODPT Terms of Use](https://www.odpt.org/terms/) (Compatible with CC BY 4.0).
- **Geospatial Data**: Sourced from **[MLIT](https://www.mlit.go.jp/kokudoseisaku/gis/)** (国土交通省) - National Land Numerical Information.
    - *License*: [MLIT Standard Terms of Use](https://www.mlit.go.jp/kokudoseisaku/gis/terms.html) (CC BY 4.0 compatible).
- **Station Data**: **[Ekidata.jp](https://ekidata.jp)**.
- **Linked Open Data**: **[JRSLOD](https://uedayou.net/jrslod/)** datasets.

> *Note: While RailLOOP itself is open source, the map data and railway icons cached locally are subject to their original copyright holders' terms.*