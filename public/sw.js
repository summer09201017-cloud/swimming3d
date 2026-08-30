// 網路優先 HTML+快取優先資產(07-13 修復:cache-first 舊 index 會在部署後 404 壞站)
const CACHE_NAME = "swimming-nf3"; // nf1:游泳(自由式)3D 首發(fork 自 speedskating3d;50m 直道泳池+換氣時機+蹬牆轉身)
const CORE_ASSETS = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {})).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve()))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  /* 🌐 0813(能A 批次):跨來源請求**不走本 SW 的快取邏輯**。
     ★ 由來:原本任何 fetch 失敗都掉進下面的 `.catch(() => caches.match("/"))`,
       於是**跨域資源失敗會變成「HTTP 200 + 我們自己的首頁 HTML」** ——
       res.ok 是 true、狀態碼 200 ⇒ 呼叫端連「失敗了」都判斷不出來:
       拿 HTML 去 JSON.parse 會被 catch 成「這一帶沒有資料」之類的業務結論(靜默降級),
       圖片/圖磚則看起來像「網路慢」。而且本機常常沒註冊 SW ⇒ 典型的「本機全綠、線上全死」。
     ★ 0812 sheepflock3d 實錘:真實建築量體「本機好好的、線上永遠是空的」查很久,
       最後發現 Overpass 回的是 <!doctype html> —— 我們自己的首頁。
     ⇒ 這裡**代打**(不是放手不管):實測頁面直打會被對方擋、SW 代打反而通;
       不快取、不退路、失敗就讓它失敗 —— 讓呼叫端**看得到真正的失敗**。 */
  if (new URL(request.url).origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }


  // HTML/導覽:網路優先(拿到就更新快取),離線才用快取——部署新版立即生效
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match("/"))),
    );
    return;
  }

  // 其他資產(vite hashed 檔名=不可變):快取優先,沒有才抓網路回填
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (request.url.startsWith(self.location.origin) && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return res;
      }).catch(() => caches.match("/"));
    }),
  );
});

// 🏷️ 版號回報(0831 VT1 批次):頁尾徽章問「實際執行中的版本」,答案=本 SW 的快取名。
self.addEventListener('message', function (e) {
  if (e && e.data === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'SW_VERSION', v: CACHE_NAME });
});
