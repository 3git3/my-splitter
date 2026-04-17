/* =====================================================================
   無劣化メディア分割ツール — app.js（修正版）
   FFmpeg corePath を 0.11.6 に統一済み
   SharedArrayBuffer 対応（coi-serviceworker.js 前提）
   ===================================================================== */

(function () {
  "use strict";

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

  var ffmpeg = null;
  var ffmpegLoaded = false;

  fileInput.addEventListener("change", function () {
    var file = fileInput.files[0];
    if (!file) { fileInfo.classList.remove("show"); return; }
    var mb = (file.size / 1024 / 1024).toFixed(2);
    fileInfo.textContent = file.name + "  /  " + mb + " MB";
    fileInfo.classList.add("show");
  });

  function setProgress(text, pct) {
    if (progText) progText.textContent = text;
    if (progPct)  progPct.textContent  = Math.round(pct) + "%";
    if (progFill) progFill.style.width = pct + "%";
  }

  function addLog(line) {
    if (!logBox) return;
    logBox.textContent += line + "\n";
    logBox.scrollTop = logBox.scrollHeight;
  }

  function resetUI() {
    if (resultCard) resultCard.classList.remove("show");
    if (errorCard)  errorCard.classList.remove("show");
    if (logBox)     logBox.textContent = "";
    setProgress("準備中...", 0);
  }

  /* --------------------------------------------------------------
     ★ 修正ポイント：corePath を 0.11.6 に統一
     -------------------------------------------------------------- */
  function loadFFmpeg() {
    return new Promise(function (resolve, reject) {
      if (ffmpegLoaded) { resolve(); return; }

      if (typeof FFmpeg === "undefined" || !FFmpeg.createFFmpeg) {
        reject(new Error(
          "FFmpeg ライブラリが読み込まれていません。\n" +
          "ページをリロードしてもう一度お試しください。"
        ));
        return;
      }

      ffmpeg = FFmpeg.createFFmpeg({
        log: false,
        corePath: "https://unpkg.com/@ffmpeg/core@0.11.6/dist/ffmpeg-core.js?v=2"
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

  function getDuration(fileName) {
    return new Promise(function (resolve) {
      var duration = null;

      ffmpeg.setLogger(function (obj) {
        var message = obj.message || "";
        var m = message.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          var h   = parseInt(m[1], 10);
          var min = parseInt(m[2], 10);
          var sec = parseFloat(m[3]);
          duration = h * 3600 + min * 60 + sec;
          addLog("[info] 長さ検出: " + duration.toFixed(2) + "s");
        }
      });

      ffmpeg.run("-i", fileName, "-f", "null", "-")
        .catch(function () {})
        .finally(function () {
          ffmpeg.setLogger(function () {});
          resolve(duration);
        });
    });
  }

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

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

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
        await loadFFmpeg();

        setProgress("ファイルを読み込み中...", 10);
        var fileSizeMB = file.size / 1024 / 1024;
        addLog("[info] 書き込み中: " + file.name);

        ffmpeg.FS("writeFile", file.name, await FFmpeg.fetchFile(file));

        if (fileSizeMB <= mb) {
          alert("ファイルサイズが指定値以下です。分割の必要はありません。");
          splitBtn.disabled = false;
          return;
        }

        setProgress("メディア情報を取得中...", 20);
        var duration = await getDuration(file.name);

        if (!duration || duration <= 0) {
          throw new Error("ファイルの長さを取得できませんでした。");
        }

        var targetBytes      = mb * 1024 * 1024;
        var estimatedBps     = (file.size * 8) / duration;
        var chunkDurationSec = (targetBytes * 8) / estimatedBps;
        var numParts         = Math.ceil(duration / chunkDurationSec);

        addLog("[info] 分割数=" + numParts);

        var ext      = file.name.split(".").pop();
        var baseName = file.name.slice(0, -(ext.length + 1));
        var outputs  = [];

        for (var i = 0; i < numParts; i++) {
          var startSec = i * chunkDurationSec;
          var pad      = String(i + 1).padStart(3, "0");
          var outName  = baseName + "_part" + pad + "." + ext;
          var pct      = 25 + (i / numParts) * 70;

          setProgress("分割中... (" + (i + 1) + " / " + numParts + ")", pct);
          addLog("[split] " + outName);

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

        setProgress("ダウンロード中...", 97);
        addLog("[info] ダウンロード開始");

        for (var j = 0; j < outputs.length; j++) {
          downloadFromFS(outputs[j], outputs[j]);
          try { ffmpeg.FS("unlink", outputs[j]); } catch (e2) {}
          await sleep(350);
        }

        try { ffmpeg.FS("unlink", file.name); } catch (e3) {}

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
