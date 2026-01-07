# RailLOOP - 个人向け旅び鉄手帳

Presented & Maintained by [@OsakaLOOP](https://github.com/OsakaLOOP)

> **DON'T PANIC.**

### 1. 用户指南 (The Railfan's Guide to the Galaxy)

《[银河系铁道迷指南](https://en.wikipedia.org/wiki/The_Hitchhiker%27s_Guide_to_the_Galaxy)》对于 **RailLOOP** 的定义如下: 这是一个几乎完全由 “白嫖” (Freeloader) 精神驱动的, 基于 [Serverless](https://en.wikipedia.org/wiki/Serverless_computing) / [Edge-function](https://en.wikipedia.org/wiki/Edge_computing) 架构的, 富有忠实, 多样以及泛二精神的旅铁记录装置. 它看起来像是一个复杂的工程奇迹, 但实际上它大部分由 [WD-40™](https://www.wd40.com), 祈祷和免费额度 (真的很多, 但是需要提防系统误判和脚本小子) 维系.

如果你是一个刚刚被传送至此的星际搭车客 (或者不受欢迎的 [JR](https://www.jr-odekake.net) 铁道迷), 请务必遵循以下生存守则:

- **记录行程**: 在首页点击“记录新行程”，支持公司/线路选择或自动规划。
- **地图模式**: 可视化查看您的足迹，支持上传 GeoJSON 地图文件。
- **GitHub 挂件**: 绑定 GitHub 账号后，可生成动态 SVG 卡片展示在您的个人主页。

* **存在与持久性 (The Persistence)**
    * **关于 Bypass 的警告**: 请务必定时备份本地存储, 或者至少登陆账号, 绑定 [GitHub](https://github.com) 就更好了 (虽然这和存储没有更多关系, 但是可以用于 Socializing). 虽然我们在逻辑上基于 “线路/车站名称和 ID” 进行了深度绑定, 拥有 **12 个 9** 的理论数据可靠性 (这甚至高于 CDN 的承诺). 这意味着, 即便 [沃贡人](https://hitchhikers.fandom.com/wiki/Vogons) (或者 [JR 北海道](https://www.jrhokkaido.co.jp)) 为了建设一条新的新干线联络线 (这不太可能) 而决定残酷地废线某些物理设施 (这绝对可能), 只要车站 ID 还在, 你的记录就不会随版本更迭而失效. 但如果你清空了缓存且没绑定账号, 数据就会和曾经的地球(消歧义: [The Earth - Supercomputer](https://hitchhikers.fandom.com/wiki/Earth), not [The Earth - Planet](https://en.wikipedia.org/wiki/Earth))一样消失.

* **可用性之哲学 (The Probability)**
    * **12 个 9 的真相**: 请注意, 这个高得离谱的可用性数字属于我们白嫖的 CDN 服务商 ([EdgeOne](https://cloud.tencent.com/product/teo)), 而非本服务的代码质量. 这意味着, 服务器几乎永不宕机, 但**并不**保证运行在上面的代码逻辑不会像一台 [无限非概率驱动引擎](https://hitchhikers.fandom.com/wiki/Infinite_Improbability_Drive) (Infinite Improbability Drive) 一样, 突然把你的路径规划变成一个 [200 km/h 达速运行的绿色垃圾桶](https://en.wikipedia.org/wiki/China_Railway_CR200J).

* **存在主义图床 (Image Availability)**
    * 正如指南中关于 “[抹茶](https://en.wikipedia.org/wiki/Matcha)” 的条目经常让飞船电脑崩溃一样, 本服务**不提供图床**.
    * 如果你想展示你与新干线 [黄医生](https://en.wikipedia.org/wiki/Doctor_Yellow) 的自拍 (没人关心前者), 请**自己想办法** ([S3](https://aws.amazon.com/s3), [R2](https://www.cloudflare.com/developer-platform/r2), 或者某种古老的微博外链技术), 然后手动粘贴 URL. 这被视为一种对核心玩家的筛选机制 —— 只有真正懂得如何在数字荒原生存的人, 才配拥有思想, 尊严, 记录和图片.

* **社交身份象征 (Badges)**
    * 我们开发了 **GitHub Readme Badge**. 这是一个动态 [SVG](https://www.w3.org/Graphics/SVG/), 旨在向其他碳基生物炫耀你在这个星球的铁轨上消耗了多少不可再生的时间, 或者找到类似的没有任何生殖希望的同类 ([同性](https://mzh.moegirl.org.cn/%E4%BC%AA%E5%A8%98)) 们.

---

### 2. 免责协议 (The Bureaucracy)

在使用本服务前, 请知晓以下条款. 这些条款像银河系行政规划图一样不可更改, 但通常被放在没人看的地下室里.

我们收集以下信息, 仅用于提供对应服务：
- 用户名与加密后的密码。
- 您主动记录的行程数据与图钉信息。
- 通过 GitHub 登录时的公开资料（头像、昵称）。

* **与不可名状的 py 交易**
    本服务的架构站在无数巨人的肩膀上, 以及一些处于灰色地带的努力:
    * **基础设施**: 感谢 **[EdgeOne](https://cloud.tencent.com/product/teo)** 提供了 Serverless 计算节点和 Pages CDN.
    * **特别鸣谢**: **[闲鱼](https://2.taobao.com)**. 正是在这个混乱而有高效的市场里, 我们以 10r 的低廉价格搞到了一个服务器 Token, 成功绕过了家用宽带备案那如同沃贡官僚主义般的繁琐限制, 让早期的原型机得以在物理世界呼吸. 虽然后来为了稳定迁移到了 Pages, 但这笔交易将永载史册.
    * **数据源**: **[国土交通省 (MLIT)](https://www.mlit.go.jp)**, **[ODPT](https://www.odpt.org)**, **[Ekidata](https://ekidata.jp)** 和 **[鉄道駅LOD](https://uedayou.net/jrslod/)**. (见开源协议)

* **关于 “山手线” 的拓扑悖论 (The Yamanote Paradox)**
    * **现象**: 你可能会发现, 地图上的 **[山手线](https://en.wikipedia.org/wiki/Yamanote_Line)** 并不是一个闭合的环, 而是一个从品川经新宿到田端的 “C” 字形.
    * **解释**: 请不要向我们提交 Bug 报告. 在国土交通省 (以及绝大多数严格的 [GIS](https://www.esri.com/en-us/what-is-gis/overview) 数据库) 的法律定义里, **“山手线” 作为一个法律实体, 确实只是那个 “C” 字形**. 剩下的部分分别借用了 [东海道本线](https://en.wikipedia.org/wiki/Tokaido_Main_Line) 和 [东北本线](https://en.wikipedia.org/wiki/Tohoku_Main_Line) 的轨道.
    * **结论**: 如果目前的前端渲染看起来像个断开的圆环, 那不是 Bug, 那是对官僚主义法律现实的尊重 (当然, 也可能是因为我们的环线与上下行分离逻辑还没写好, 导致那 5% 的几何展示有瑕疵).

* **隐私性 (Privacy)**
    * **盒子模型**: 我们采用 [KV](https://en.wikipedia.org/wiki/Key%E2%80%93value_database) 存储, 一切用户信息的查询基于一个简单的 Hash Key (严格讲是两个).
    * **警告**: 这就像是你把日记放在了一个没有锁, 但藏在银河系某个角落的箱子里. 理论上没人找得到, 但本服务**不是**为了存储 [NERV](https://evangelion.fandom.com/wiki/NERV) 机密设计的. **严禁上传家庭住址, 真实姓名或任何你不想让沃贡 Captain 看到的敏感信息, 否则你可能被帽子叔叔上门念诗而亡.**

---

### 3. todo 和版本历史 (The Prophecies)

#### Changelog

* **v0.10**: 纯前端 "Vibe Coding"。卡到爆，勉强能用。路线绘制正确率：**0%**。
* **v0.20**: 优化了线路查找和自动规划，打磨界面细节。完全重写渲染和规划逻辑 (痛苦)，增加 CDN 自动导入。
* **v0.30 (Current)**: 增加了基于 KV 存储的用户账户体系，集成 GitHub 登录。

---

而以下是我们试图将这个混乱而拥挤的宇宙理出头绪的计划, 按 “只要不做就会错” 到 “这简直是魔法” 的顺序排列:

#### Phase 1: 基础生存 (Earning Rice for Fufu)
1.  **Badge 系统大重构**: 生成独立的 Hash 列表用于公开展示, 不再强迫用户暴露自己的鉴权 Key. 同时支持生成不同版本的 Badge, 以满足不同星球物种的审美, 或者你想保存每一次无意义的出入国记录.
2.  **数据库大清洗**: 修复线路数据库. 虽然你可以手动选择或者导入自己的 [GeoJSON](https://geojson.org), 但我们需要为了大多数用户手动把那些在 GIS 定义里断开的线路 (比如那个山手线 C 字) 在视觉上焊起来, 毕竟人类喜欢圆的东西.
3.  **Ekidata 大引入**: 引入换乘数据, 让路径规划看起来不那么像是在掷骰子, 或者 [西園寺](https://www.youtube.com/@saionjichannel) 和 [スーツ旅行](https://www.youtube.com/@SuitTravel) 的大回り乗車罰ゲーム.
4.  **资源大开发**: 将引用的 CDN 线路图标本地化, 防止上游服务商因为我们白嫖太多而切断图片供应, 或者被墙.

#### Phase 2: 引擎升级 (Improving the Drive)
5.  **性能提升**: 目前的地图底图渲染会让你的 CPU 风扇发出像即将起飞的航天飞机 (永远看不到了, 所以或许 [SLS](https://www.nasa.gov/exploration/systems/sls/index.html)) 一样的声音. 我们将把 GeoJSON **底图化**, 减少大量 DOM/SVG 节点的活动渲染压力. 当然更急需的是不要每次 [React](https://react.dev) 事件都重新计算 (已经改进了, 但还不够好).
6.  **算法优化**: 试图将路径规划的成功率从 50% 提升到更体面的数值, 至少不能总是建议用户虚空换乘, 或者浪费 [途中下車](https://www.jreast.co.jp/kippu/1103.html) 机会, 可以的话还会引入票价和时刻表.

#### Phase 3: 核心重铸 (Reframe and Refractory)
7.  **架构跃迁**: 引入正规的图床和 [SQL](https://en.wikipedia.org/wiki/SQL) 数据库, 抛弃现在的 KV 缝合怪方案. 这就像从用算盘计算直接升级到 [GTX® 5090](https://www.nvidia.com).
8.  **隐私护盾**: 综合提升隐私防护, 不再仅仅依赖 “没人猜得到你的 Hash” 这种概率学防御, 并且使用 [JWT](https://jwt.io) 保护你的 URL.

#### Phase 4: 终极答案 (Life, the Universe, and Everything)
9.  **外部 API 拓展**: 打破数据孤岛.
10. **上下文感知**: 结合当前播放的音乐或地理位置自动多维记录.
11. **巡礼系统 (パレード)**: 这才是本服务的终极形态. 从单纯的 “打点” 升级为以现地活动 (Live, 场贩, 圣地巡礼, [終末旅行](https://en.wikipedia.org/wiki/Girls'_Last_Tour)) 为核心的记录系统. (为了方便夜鹿厨, 可能还要引入瑞典斯德哥尔摩, 阿姆斯特丹)
12. **视觉盛宴**: 车票渲染, 站台 [LED](https://en.wikipedia.org/wiki/Dot-matrix_display), 回忆手账页面展示. 防止你忘了拍照 (或者被站务阻止), 让你的回忆看起来比实际发生的更美好 (真的).
13. **站娘设计**: 现向全社会公开征集, 地点还是在那个地下室. 或者等我精通板绘和 [Live2D](https://www.live2d.com).
14. **提供 API**: 开源项目怎么能少的了这个.

*Sit down and Enjoy the Tabitetsu travel.(如果你有美妙的指定席座位, 否则, 当我没说)*\
*P.S.* 如果你们当中有外星人、未来人、超能力者, 请勿遵守本指南.
---

### License & Credits

#### Open Source License
Distributed under the **MIT License**. See `LICENSE` for more information.

#### Acknowledgements
本服务依照相关数据源的使用条款引用并展示数据. 二次开发或分发时请务必遵守以下协议:

* **Public Transportation Data**: Powered by **[ODPT](https://www.odpt.org)** (Open Data Public Transportation Center).
    * *License*: [ODPT Terms of Use](https://www.odpt.org/terms/) (Compatible with CC BY 4.0).
* **Geospatial Data**: Sourced from **[MLIT](https://www.mlit.go.jp/kokudoseisaku/gis/)** (Ministry of Land, Infrastructure, Transport and Tourism) - National Land Numerical Information.
    * *License*: [MLIT Standard Terms of Use](https://www.mlit.go.jp/kokudoseisaku/gis/terms.html) (CC BY 4.0 compatible).
* **Station Data**: **[Ekidata.jp](https://ekidata.jp)**.
* **Tetsudou Linked Open Data**: **[JRSLOD](https://uedayou.net/jrslod/)** datasets.

> *Note: While RailLOOP itself is open source, the map data and railway icons cached locally are subject to their original copyright holders' terms.*