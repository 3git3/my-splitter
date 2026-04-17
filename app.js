/* =====================================================================
   無劣化メディア分割ツール — app.js
   依存: @ffmpeg/ffmpeg@0.11.6 (CDN)、coi-serviceworker.js (同オリジン)

   【HTML の ID と app.js の対応】
     #file-input    ファイル選択
     #file-info     ファイル名・サイズ表示
     #mb-input      MB 数値入力
     #split-btn     分割開始ボタン
     #progress-card 進捗エリア（show クラスで表示）
     #prog-text     進捗テキスト
     #prog-pct      パーセント表示
     #prog-fill     プログレスバー
     #log-box       ログ出力
     #result-card   完了カード（show クラスで表示）
     #result-body   完了メッセージ
     #error-card    エラーカード（show クラスで表示）
     #error-body    エラーメッセージ
   ===================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* DOM 参照（null チェック付き）                                        */
  /* ------------------------------------------------------------------ */
  function $(id) {
    var el = document.getElementById(id);
    if (!el) console.error("[app] 要素が見つかりません: #" + id);
    return el;
  }

  var fileInput    = $("file-input");
  var fileInfo     = $("file-info");
  var mbInput      = $("mb-input");
  var splitBtn     = $("split-btn");
  var progressCard = $("progress-card");
  var progText     = $("prog-text");
  var progPct      = $("prog-pct");
  var progFill     = $("prog-fill");
  var logBox       = $("log-box");
  var resultCard   = $("result-card");
  var resultBody   = $("result-body");
  var errorCard    = $("error-card");
  var errorBody    = $("error-body");

  /* ------------------------------------------------------------------ */
  /* 状態                                                                 */
  /* ------------------------------------------------------------------ */
  var ffmpeg = null;
  var ffmpegLoaded = false;

  /* ------------------------------------------------------------------ */
  /* ファイル選択時のサイズ表示                                           */
  /* ------------------------------------------------------------------ */
  fileInput.addEventListener("change", function () {
    var file = fileInput.files[0];
    if (!file) { fileInfo.classList.remove("show"); return; }
    var mb = (file.size / 1024 / 1024).toFixed(2);
    fileInfo.textContent = file.name + "  /  " + mb + " MB";
    fileInfo.classList.add("show");
  });

  /* ------------------------------------------------------------------ */
  /* 進捗更新                                                             */
  /* ------------------------------------------------------------------ */
  function setProgress(text, pct) {
    if (progText) progText.textContent = text;
    if (progPct)  progPct.textContent  = Math.round(pct) + "%";
    if (progFill) progFill.style.width = pct + "%";
  }

  /* ------------------------------------------------------------------ */
  /* ログ追記                                                             */
  /* ------------------------------------------------------------------ */
  function addLog(line) {
    if (!logBox) return;
    logBox.textContent += line + "\n";
    logBox.scrollTop = logBox.scrollHeight;
  }

  /* ------------------------------------------------------------------ */
  /* UI リセット                                                          */
  /* ------------------------------------------------------------------ */
  function resetUI() {
    if (resultCard) resultCard.classList.remove("show");
    if (errorCard)  errorCard.classList.remove("show");
    if (logBox)     logBox.textContent = "";
    setProgress("準備中...", 0);
  }

  /* ------------------------------------------------------------------ */
  /* ffmpeg.wasm ロード                                                   */
  /*   corePath を明示する → unpkg の URL 解決失敗を防ぐ                 */
  /* ------------------------------------------------------------------ */
  function loadFFmpeg() {
    return new Promise(function (resolve, reject) {
      if (ffmpegLoaded) { resolve(); return; }

      /* FFmpeg グローバルが存在するか確認 */
      if (typeof FFmpeg === "undefined" || !FFmpeg.createFFmpeg) {
        reject(new Error(
          "FFmpeg ライブラリが読み込まれていません。\n" +
          "ページをリロードしてもう一度お試しください。"
        ));
        return;
      }

      ffmpeg = FFmpeg.createFFmpeg({
        log: false,
        corePath: "https://unpkg.com/@ffmpeg/core@0.11.6/dist/ffmpeg-core.js",
      });

      setProgress("FFmpeg をロード中...", 5);
      addLog("[info] ffmpeg-core を読み込んでいます...");

      ffmpeg.load()
        .then(function () {
          ffmpegLoaded = true;
          addLog("[info] FFmpeg 準備完了");
          resolve();
        })
        .catch(reject);
    });
  }

  /* ------------------------------------------------------------------ */
  /* duration 取得                                                        */
  /*   ffmpeg -i <file> -f null - はエラーになるが、                      */
  /*   その前に "Duration: HH:MM:SS.mm" がログに出る。                   */
  /*   setLogger でそれを横取りして Promise で返す。                      */
  /* ------------------------------------------------------------------ */
  function getDuration(fileName) {
    return new Promise(function (resolve) {
      var duration = null;

      /* カスタムロガーをセット */
      ffmpeg.setLogger(function (obj) {
        var message = obj.message || "";
        var m = message.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          var h   = parseInt(m[1], 10);
          var min = parseInt(m[2], 10);
          var sec = parseFloat(m[3]);
          duration = h * 3600 + min * 60 + sec;
          addLog("[info] 長さ検出: " + h + "h " + min + "m " + sec.toFixed(2) + "s = " + duration.toFixed(2) + "s");
        }
      });

      /* エラーになるコマンドだが duration は取れる */
      ffmpeg.run("-i", fileName, "-f", "null", "-")
        .catch(function () { /* 想定内エラー */ })
        .finally(function () {
          /* ロガーを無音に戻す */
          ffmpeg.setLogger(function () {});
          resolve(duration);
        });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 仮想 FS → ブラウザ ダウンロード                                      */
  /* ------------------------------------------------------------------ */
  function downloadFromFS(fsName, downloadName) {
    var data = ffmpeg.FS("readFile", fsName);
    var blob = new Blob([data.buffer]);
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement("a");
    a.href     = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  /* ------------------------------------------------------------------ */
  /* sleep ユーティリティ                                                 */
  /* ------------------------------------------------------------------ */
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* ------------------------------------------------------------------ */
  /* メイン処理                                                           */
  /* ------------------------------------------------------------------ */
  splitBtn.addEventListener("click", function () {
    (async function () {

      resetUI();

      var file = fileInput.files[0];
      if (!file) { alert("ファイルを選択してください。"); return; }

      var mb = parseInt(mbInput.value, 10);
      if (!mb || mb <= 0) { alert("MB には正の整数を入力してください。"); return; }

      splitBtn.disabled = true;
      progressCard.classList.add("show");

      try {
        /* 1. ffmpeg ロード */
        await loadFFmpeg();

        /* 2. ファイルを仮想 FS へ書き込み */
        setProgress("ファイルを読み込み中...", 10);
        var fileSizeMB = file.size / 1024 / 1024;
        addLog("[info] 書き込み中: " + file.name + "  (" + fileSizeMB.toFixed(2) + " MB)");

        ffmpeg.FS("writeFile", file.name, await FFmpeg.fetchFile(file));

        /* 3. サイズチェック */
        if (fileSizeMB <= mb) {
          alert(
            "ファイルサイズ (" + fileSizeMB.toFixed(2) + " MB) が\n" +
            "指定値 (" + mb + " MB) 以下です。分割の必要はありません。"
          );
          splitBtn.disabled = false;
          return;
        }

        /* 4. duration 取得 */
        setProgress("メディア情報を取得中...", 20);
        var duration = await getDuration(file.name);

        if (!duration || duration <= 0) {
          throw new Error(
            "ファイルの長さを取得できませんでした。\n" +
            "対応フォーマット: mp3 / mp4 / m4a / mkv / avi / wav / aac / ogg / webm\n" +
            "ファイルが壊れていないか確認してください。"
          );
        }

        /* 5. 分割数・チャンク長の計算 */
        var targetBytes      = mb * 1024 * 1024;
        var estimatedBps     = (file.size * 8) / duration;        /* bits/sec */
        var chunkDurationSec = (targetBytes * 8) / estimatedBps;  /* sec */
        var numParts         = Math.ceil(duration / chunkDurationSec);

        addLog(
          "[info] duration=" + duration.toFixed(2) + "s  " +
          "bitrate=" + (estimatedBps / 1000).toFixed(0) + "kbps"
        );
        addLog(
          "[info] 1チャンク≈" + chunkDurationSec.toFixed(2) + "s  " +
          "分割数=" + numParts
        );

        /* 6. 分割実行 */
        var ext      = file.name.split(".").pop();
        var baseName = file.name.slice(0, -(ext.length + 1));
        var outputs  = [];

        for (var i = 0; i < numParts; i++) {
          var startSec = i * chunkDurationSec;
          var pad      = String(i + 1).padStart(3, "0");
          var outName  = baseName + "_part" + pad + "." + ext;
          var pct      = 25 + (i / numParts) * 70;

          setProgress("分割中... (" + (i + 1) + " / " + numParts + ")", pct);
          addLog("[split] part " + (i + 1) + "/" + numParts + " → " + outName);

          /*
           * -ss を -i より前に置く = 入力シーク（高速・精度良）
           * -c copy = 無劣化コピー
           * -avoid_negative_ts make_zero = 先頭 TS を 0 に正規化
           * 最後のチャンクは -t を省略して末尾まで含める
           */
          var args = [
            "-ss", startSec.toFixed(6),
            "-i",  file.name,
            "-c",  "copy",
            "-avoid_negative_ts", "make_zero",
          ];

          if (i < numParts - 1) {
            args.push("-t", chunkDurationSec.toFixed(6));
          }

          args.push(outName);
          await ffmpeg.run.apply(ffmpeg, args);
          outputs.push(outName);
        }

        /* 7. ダウンロード */
        setProgress("ダウンロード中...", 97);
        addLog("[info] " + outputs.length + " ファイルをダウンロードします");

        for (var j = 0; j < outputs.length; j++) {
          downloadFromFS(outputs[j], outputs[j]);
          try { ffmpeg.FS("unlink", outputs[j]); } catch (e2) {}
          await sleep(350);
        }

        try { ffmpeg.FS("unlink", file.name); } catch (e3) {}

        /* 8. 完了表示 */
        setProgress("完了", 100);
        var lines = [outputs.length + " 個のファイルに分割しました。"];
        outputs.forEach(function (n, idx) { lines.push("  " + (idx + 1) + ". " + n); });
        resultBody.textContent = lines.join("\n");
        resultCard.classList.add("show");

      } catch (err) {
        console.error(err);
        errorBody.textContent = String(err.message || err);
        errorCard.classList.add("show");
        addLog("[error] " + String(err.message || err));
      } finally {
        splitBtn.disabled = false;
      }

    })();
  });

})();
