/*
 * coi-serviceworker.js
 * このファイルは index.html と同じディレクトリに置いてください。
 * unpkg.com から読み込むのではなく、必ずリポジトリに含める必要があります。
 *
 * 役割:
 *   <script> タグとして読み込まれたとき → 自分自身を Service Worker として登録する
 *   Service Worker として動作しているとき → fetch をフックして COOP/COEP ヘッダーを付与する
 *
 * これにより GitHub Pages でも SharedArrayBuffer が使えるようになります。
 */

/* ================================================================
   【モード A】通常ページの <script> として実行されているとき
   ================================================================ */
if (typeof window !== "undefined") {
  (function () {
    // すでに cross-origin isolated なら何もしない
    if (window.crossOriginIsolated) return;

    if (!window.isSecureContext) {
      console.warn("[coi-sw] HTTPS でないため SharedArrayBuffer は使えません");
      return;
    }

    if (!("serviceWorker" in navigator)) {
      console.warn("[coi-sw] Service Worker 非対応ブラウザです");
      return;
    }

    // このスクリプト自身を Service Worker として登録する
    navigator.serviceWorker
      .register(document.currentScript.src)
      .then(function (reg) {
        function waitForActivation(worker) {
          worker.addEventListener("statechange", function (e) {
            if (e.target.state === "activated") {
              // Service Worker が有効になったらリロード
              window.location.reload();
            }
          });
        }

        if (reg.installing) {
          // インストール中 → 完了を待ってリロード
          waitForActivation(reg.installing);
        } else if (reg.waiting) {
          // 待機中 → スキップしてリロード
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
          waitForActivation(reg.waiting);
        } else if (reg.active) {
          // すでに有効だが controller がない（=初回登録後の状態）→ リロード
          if (!navigator.serviceWorker.controller) {
            window.location.reload();
          }
        }
      })
      .catch(function (e) {
        console.error("[coi-sw] Service Worker 登録失敗:", e);
      });
  })();
}

/* ================================================================
   【モード B】Service Worker として動作しているとき
   ================================================================ */
if (
  typeof ServiceWorkerGlobalScope !== "undefined" &&
  self instanceof ServiceWorkerGlobalScope
) {
  self.addEventListener("install", function () {
    // 旧バージョンを待たずに即座に有効化
    self.skipWaiting();
  });

  self.addEventListener("activate", function (e) {
    // すべてのクライアントをこの SW の管理下に置く
    e.waitUntil(self.clients.claim());
  });

  self.addEventListener("message", function (e) {
    if (e.data && e.data.type === "SKIP_WAITING") {
      self.skipWaiting();
    }
  });

  self.addEventListener("fetch", function (e) {
    // キャッシュのみリクエストかつ cross-origin は無視
    if (
      e.request.cache === "only-if-cached" &&
      e.request.mode !== "same-origin"
    ) {
      return;
    }

    e.respondWith(
      fetch(e.request)
        .then(function (response) {
          // リダイレクトや opaque レスポンスはそのまま返す
          if (!response || response.status === 0 || response.type === "opaque") {
            return response;
          }

          // ヘッダーを複製して COOP / COEP を付与
          var newHeaders = new Headers(response.headers);
          newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
          newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        })
        .catch(function () {
          // ネットワークエラーはそのまま投げる
          return fetch(e.request);
        })
    );
  });
}
