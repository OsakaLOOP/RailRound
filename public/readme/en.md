# RailLOOP - Personal Railway Travel Log

Presented & Maintained by [@OsakaLOOP](https://github.com/OsakaLOOP)

> **DON'T PANIC.**

### 1. The Guide

The *[Railfan's Guide to the Galaxy](https://en.wikipedia.org/wiki/The_Hitchhiker%27s_Guide_to_the_Galaxy)* defines **RailLOOP** as follows: It is a railway travel recording device driven almost entirely by the spirit of "Freeloading", built upon a [Serverless](https://en.wikipedia.org/wiki/Serverless_computing) / [Edge-function](https://en.wikipedia.org/wiki/Edge_computing) architecture, rich in loyalty, diversity, and subcultural spirit. It looks like a complex engineering miracle, but in reality, it is mostly held together by [WD-40™](https://www.wd40.com), prayers, and free tiers (which are abundant, but one must beware of system false positives and script kiddies).

If you are an interstellar hitchhiker who has just been beamed here (or an unpopular [JR](https://www.jr-odekake.net) rail fan), please ensure you follow these survival rules:

- **Record Journey**: Click "Record New Trip" on the homepage. Supports selection by Operator/Line or automatic routing.
- **Map Mode**: Visualize your footprints. Supports uploading custom GeoJSON map files.
- **GitHub Widget**: After binding your GitHub account, generate a dynamic SVG card to display on your personal profile.

- **The Persistence**
    - **Warning regarding Bypasses**: Please adhere to regular local storage backups, or at least log in and bind your [GitHub](https://github.com) account (although this has little to do with storage, it is good for Socializing). Although we are logically deeply bound based on "Line/Station Names and IDs", possessing a theoretical data reliability of **12 Nines** (which is even higher than the CDN's promise). This means that even if the [Vogons](https://hitchhikers.fandom.com/wiki/Vogons) (or [JR Hokkaido](https://www.jrhokkaido.co.jp)) decide to brutally abolish certain physical facilities to build a new Shinkansen bypass (highly unlikely) or for other reasons (absolutely likely), as long as the Station ID remains, your records will not expire with version updates. However, if you clear your cache without binding an account, your data will vanish just like the [Earth](https://hitchhikers.fandom.com/wiki/Earth) (Disambiguation: [The Earth - Supercomputer](https://hitchhikers.fandom.com/wiki/Earth), not [The Earth - Planet](https://en.wikipedia.org/wiki/Earth)).

- **The Probability**
    - **The Truth about 12 Nines**: Please note that this ridiculously high availability figure belongs to our freeloaded CDN provider ([EdgeOne](https://cloud.tencent.com/product/teo)), not the code quality of this service. This means the server almost never goes down, but it **does not** guarantee that the code logic running on top of it won't act like an [Infinite Improbability Drive](https://hitchhikers.fandom.com/wiki/Infinite_Improbability_Drive), suddenly turning your route planning into a green trash can running at 200 km/h.

- **Image Availability (Existentialism)**
    * Just as the entry on "[Matcha](https://en.wikipedia.org/wiki/Matcha)" (Tea) in the Guide often causes the ship's computer to crash, this service **does not provide image hosting**.
    * If you wish to display your selfie with the Shinkansen [Doctor Yellow](https://en.wikipedia.org/wiki/Doctor_Yellow) (no one cares about the former), please **figure it out yourself** ([S3](https://aws.amazon.com/s3), [R2](https://www.cloudflare.com/developer-platform/r2), or some ancient Weibo external link technology), and manually paste the URL. This is regarded as a screening mechanism for core players—only those who truly know how to survive in the digital wasteland deserve thoughts, dignity, records, and images.

- **Badges (Social Status Symbols)**
    * We have developed a **GitHub Readme Badge**. This is a dynamic [SVG](https://www.w3.org/Graphics/SVG/) designed to show off to other carbon-based lifeforms how much non-renewable time you have wasted on the rails of this planet, or to find similar conspecifics ([Otokonoko](https://en.wikipedia.org/wiki/Otokonoko)) with absolutely no hope of reproduction.

---

### 2. The Bureaucracy (Disclaimer)

Before using this service, please be aware of the following terms. These terms are as unchangeable as a Galactic Hyperspace Planning Map, but are usually kept in a basement where no one looks.

We collect the following information solely for the purpose of providing the corresponding services:
- Username and encrypted password.
- Trip data and pin information you actively record.
- Public profile information (avatar, nickname) accessed via GitHub login.

- **Shady Deals & Acknowledgements**
    The architecture of this service stands on the shoulders of giants, as well as some efforts in the grey area:
    - **Infrastructure**: Thanks to **[EdgeOne](https://cloud.tencent.com/product/teo)** for providing Serverless compute nodes and Pages CDN.
    - **Special Thanks**: **[Xianyu](https://2.taobao.com)**. It was in this chaotic yet efficient marketplace that we procured a server Token for the low price of 10 RMB, successfully bypassing the Vogon-bureaucracy-like restrictions of residential broadband registration, allowing early prototypes to breathe in the physical world. Although we later migrated to Pages for stability, this transaction will go down in history.
    - **Data Sources**: **[MLIT](https://www.mlit.go.jp)**, **[ODPT](https://www.odpt.org)**, **[Ekidata](https://ekidata.jp)**, and **[JRSLOD](https://uedayou.net/jrslod/)**. (See Open Source License)

- **The Yamanote Paradox**
    - **Phenomenon**: You may notice that the **[Yamanote Line](https://en.wikipedia.org/wiki/Yamanote_Line)** on the map is not a closed loop, but a "C" shape from Shinagawa via Shinjuku to Tabata.
    - **Explanation**: Please do not submit Bug reports to us. In the legal definition of the Ministry of Land, Infrastructure, Transport and Tourism (and most strict [GIS](https://www.esri.com/en-us/what-is-gis/overview) databases), **"The Yamanote Line" as a legal entity is indeed just that "C" shape**. The remaining parts borrow tracks from the [Tokaido Main Line](https://en.wikipedia.org/wiki/Tokaido_Main_Line) and the [Tohoku Main Line](https://en.wikipedia.org/wiki/Tohoku_Main_Line).
    - **Conclusion**: If the current frontend rendering looks like a broken ring, that is not a Bug; it is respect for bureaucratic legal reality (of course, it might also be because our logic for separating the loop and inbound/outbound tracks isn't written well yet, causing flaws in that 5% of geometric display).

- **Privacy**
    - **Box Model**: We use [KV](https://en.wikipedia.org/wiki/Key%E2%80%93value_database) storage, where all user information queries are based on a simple Hash Key (strictly speaking, two).
    - **Warning**: This is like keeping your diary in a box without a lock, but hidden in a corner of the galaxy. Theoretically, no one can find it, but this service is **not** designed to store [NERV](https://evangelion.fandom.com/wiki/NERV) classified secrets. **Strictly do not upload home addresses, real names, or any sensitive information you wouldn't want the Vogon Captain to see, otherwise you may perish by having poetry read to you by the authorities.**

---

### 3. The Prophecies (Todo & History)

### Changelog

- **v0.10**: Pure frontend "Vibe Coding". Laggy as hell, barely usable. Rendering accuracy: **0%**.
- **v0.20**: Optimized route lookup and planning, polished UI details. Completely rewrote rendering and planning logic (from scratch). Added automatic CDN imports.
- **v0.30 (Current)**: Added user account system based on KV storage. Integrated GitHub login.

---

The following is our plan to make sense of this chaotic and crowded universe, ordered from "if we don't do it, it's wrong" to "this is simply magic":

#### Phase 1: Basic Survival (Earning Rice for Fufu)
1.  **Badge System Refactoring**: Generate independent Hash lists for public display, no longer forcing users to expose their authentication Keys. Also supports generating different versions of Badges to satisfy the aesthetics of different planetary species, or if you want to save every meaningless entry/exit record.
2.  **The Great Database Purge**: Fix the railway line database. Although you can manually select or import your own [GeoJSON](https://geojson.org), we need to manually weld those lines that are broken in GIS definitions (like that Yamanote "C") visually for the sake of most users, after all, humans like round things.
3.  **The Great Ekidata Introduction**: Introduce transfer data so that route planning doesn't look like dice rolling, or a "[Great Round Trip Penalty Game](https://en.wikipedia.org/wiki/Omawari_train_ride)" by [Saionji](https://www.youtube.com/@saionjichannel) and [Suits Travel](https://www.youtube.com/@SuitTravel).
4.  **Resource Development**: Localize referenced CDN line icons to prevent upstream providers from cutting off image supplies due to our excessive freeloading, or being blocked by firewalls.

#### Phase 2: Improving the Drive
5.  **Performance Boost**: Current map base rendering makes your CPU fan sound like a space shuttle (never to be seen again, so perhaps [SLS](https://www.nasa.gov/exploration/systems/sls/index.html)) about to take off. We will turn GeoJSON into **Base Maps**, reducing the active rendering pressure of massive DOM/SVG nodes. Of course, the more urgent need is to stop recalculating on every [React](https://react.dev) event (already improved, but not good enough).
6.  **Algorithm Optimization**: Attempt to raise the success rate of route planning from 50% to a more decent figure, at least stop suggesting users transfer in the void, or waste [Stopover](https://www.jreast.co.jp/kippu/1103.html) opportunities. If possible, we will also introduce fares and timetables.

#### Phase 3: Reframe and Refractory
7.  **Architectural Leap**: Introduce proper image hosting and [SQL](https://en.wikipedia.org/wiki/SQL) databases, abandoning the current KV stitch-monster solution. This is like upgrading directly from an abacus to a [GTX® 5090](https://www.nvidia.com).
8.  **Privacy Shield**: Comprehensively enhance privacy protection, no longer relying solely on the probabilistic defense of "no one can guess your Hash", and use [JWT](https://jwt.io) to protect your URLs.

#### Phase 4: Life, the Universe, and Everything
9.  **External API Expansion**: Breaking data silos.
10. **Context Awareness**: Automatically record multi-dimensionally combining currently playing music or geographical location.
11. **Pilgrimage System (Parade)**: This is the ultimate form of this service. Upgrading from simple "check-ins" to a recording system centered on on-site activities (Live concerts, merchandise sales, holy land pilgrimages, [Girls' Last Tour](https://en.wikipedia.org/wiki/Girls'_Last_Tour)). (To facilitate Yorushika fans, we might also need to introduce Stockholm, Sweden, and Amsterdam).
12. **Visual Feast**: Ticket rendering, platform [LED](https://en.wikipedia.org/wiki/Dot-matrix_display) style playback, memory handbook page display. Preventing you from forgetting to take photos (or being stopped by station staff), making your memories look better than what actually happened (truly).
13. **Station Girl Design**: Now soliciting publicly from the whole society, the location is still in that basement. Or wait until I master digital painting and [Live2D](https://www.live2d.com).

*Sit down and Enjoy the Tabitetsu travel. (If you have a wonderful reserved seat, otherwise, forget I said that)*\
*P.S. If there are any aliens, time travelers, or espers among you, please do not follow this guide.*

---

### License & Credits

#### Open Source License
Distributed under the **MIT License**. See `LICENSE` for more information.

#### Acknowledgements
This service cites and displays data in accordance with the terms of use of the relevant data sources. Please adhere to the following agreements during secondary development or distribution:

- **Public Transportation Data**: Powered by **[ODPT](https://www.odpt.org)** (Open Data Public Transportation Center).
    * *License*: [ODPT Terms of Use](https://www.odpt.org/terms/) (Compatible with CC BY 4.0).
- **Geospatial Data**: Sourced from **[MLIT](https://www.mlit.go.jp/kokudoseisaku/gis/)** (Ministry of Land, Infrastructure, Transport and Tourism) - National Land Numerical Information.
    * *License*: [MLIT Standard Terms of Use](https://www.mlit.go.jp/kokudoseisaku/gis/terms.html) (CC BY 4.0 compatible).
- **Station Data**: **[Ekidata.jp](https://ekidata.jp)**.
- **Linked Open Data**: **[JRSLOD](https://uedayou.net/jrslod/)** datasets.

> *Note: While RailLOOP itself is open source, the map data and railway icons cached locally are subject to their original copyright holders' terms.*