/* =====================================================
   無劣化メディア分割ツール — app.js
   依存: @ffmpeg/ffmpeg@0.11.6 (CDN 読み込み済み)
         coi-serviceworker (SharedArrayBuffer 解決済み)
   ===================================================== */

(function () {
  "use strict";

  /* ---- DOM 参照 ---- */
  const fileInput    = document.getElementById("fileInput");
  const fileInfo     = document.getElementById("fileInfo");
  const mbInput      = document.getElementById("mbInput");
  const splitBtn     = document.getElementById("splitBtn");
  const progressCard = document.getElementById("progressCard");
  const progressText = document.getElementById("progressText");
  const progressPct  = document.getElementById("progressPct");
  const progressFill = document.getElementById("progressFill");
  const logBox       = document.getElementById("logBox");
  const resultCard   = document.getElementById("resultCard");
  const resultBody   = document.getElementById("resultBody");
  const errorCard    = document.getElementById("errorCard");
  const errorBody    = document.getElementById("errorBody");

  /* ---- 状態 ---- */
  let ffmpeg = null;
  let ffmpegLoaded = false;

  /* ---- ファイル選択時にサイズ表示 ---- */
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) {
      fileInfo.classList.remove("visible");
      return;
    }
    const mb = (file.size / 1024 / 1024).toFixed(2);
    fileInfo.textContent = `${file.name}  /  ${mb} MB`;
    fileInfo.classList.add("visible");
  });

  /* ---- 進捗更新 ---- */
  function setProgress(text, pct) {
    progressText.textContent = text;
    progressPct.textContent  = Math.round(pct) + "%";
    progressFill.style.width = pct + "%";
  }

  /* ---- ログ追記 ---- */
  function addLog(line) {
    logBox.textContent += line + "\n";
    logBox.scrollTop = logBox.scrollHeight;
  }

  /* ---- UI リセット ---- */
  function resetUI() {
    resultCard.classList.remove("visible");
    errorCard.classList.remove("visible");
    logBox.textContent = "";
    setProgress("準備中...", 0);
  }

  /* ---- ffmpeg.wasm ロード ----
     corePath を明示しないと unpkg からの解決に失敗することがある。
     また、@ffmpeg/core のバージョンは ffmpeg と合わせる。        */
  async function loadFFmpeg() {
    if (ffmpegLoaded) return;

    const { createFFmpeg } = FFmpeg;

    ffmpeg = createFFmpeg({
      log: false, // 自前でロガーを管理するため false
      corePath: "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js",
    });

    setProgress("FFmpeg をロード中...", 5);
    addLog("[info] ffmpeg-core を読み込んでいます...");

    await ffmpeg.load();
    ffmpegLoaded = true;
    addLog("[info] FFmpeg 準備完了");
  }

  /* ---- メタデータから duration を取得 ----
     ffmpeg に -i <file> だけ渡すと出力先なしでエラー終了するが、
     その stderr に Duration: が含まれる。
     setLogger を使ってログを横取りし、Promise で包んで同期的に受け取る。 */
  function getDuration(fileName) {
    return new Promise((resolve) => {
      let duration = null;

      // ログを横取りするカスタムロガーをセット
      ffmpeg.setLogger(({ type, message }) => {
        // Duration: HH:MM:SS.mm の行を探す
        const m = message.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const h = parseInt(m[1], 10);
          const min = parseInt(m[2], 10);
          const sec = parseFloat(m[3]);
          duration = h * 3600 + min * 60 + sec;
          addLog(`[info] 長さ検出: ${h}h ${min}m ${sec.toFixed(2)}s = ${duration.toFixed(2)}s`);
        }
      });

      // -f null - は "出力しない" を意味する。エラーになるが duration は取れる。
      ffmpeg.run("-i", fileName, "-f", "null", "-")
        .catch(() => { /* Duration 取得後のエラーは無視 */ })
        .finally(() => {
          // ロガーをデフォルト（無音）に戻す
          ffmpeg.setLogger(() => {});
          resolve(duration);
        });
    });
  }

  /* ---- 仮想 FS → ブラウザ ダウンロード ---- */
  function downloadFromFS(fsName, downloadName) {
    const { fetchFile } = FFmpeg;
    const data = ffmpeg.FS("readFile", fsName);
    const blob = new Blob([data.buffer]);
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 少し遅らせてから revoke（Safari 対策）
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---- メイン処理 ---- */
  splitBtn.addEventListener("click", async () => {
    resetUI();

    const file = fileInput.files[0];
    if (!file) {
      alert("ファイルを選択してください。");
      return;
    }

    const mb = parseInt(mbInput.value, 10);
    if (!mb || mb <= 0) {
      alert("MB には正の整数を入力してください。");
      return;
    }

    /* ボタン無効化 & 進捗カード表示 */
    splitBtn.disabled = true;
    progressCard.style.display = "flex";
    progressCard.style.flexDirection = "column";

    try {
      /* 1. ffmpeg ロード */
      await loadFFmpeg();

      /* 2. ファイルを仮想 FS に書き込み */
      setProgress("ファイルを読み込み中...", 10);
      addLog(`[info] 書き込み中: ${file.name}  (${(file.size/1024/1024).toFixed(2)} MB)`);

      const { fetchFile } = FFmpeg;
      ffmpeg.FS("writeFile", file.name, await fetchFile(file));

      /* 3. ファイルサイズチェック */
      const fileSizeMB = file.size / 1024 / 1024;
      if (fileSizeMB <= mb) {
        alert(`ファイルサイズ (${fileSizeMB.toFixed(2)} MB) が指定値 (${mb} MB) 以下です。\n分割の必要はありません。`);
        splitBtn.disabled = false;
        return;
      }

      /* 4. duration 取得 */
      setProgress("メディア情報を取得中...", 20);
      const duration = await getDuration(file.name);

      if (!duration || duration <= 0) {
        throw new Error(
          "ファイルの長さを取得できませんでした。\n" +
          "・対応フォーマット: mp3, mp4, m4a, mkv, avi, wav, aac, ogg, webm\n" +
          "・ファイルが壊れていないか確認してください。"
        );
      }

      /* 5. 分割計算
         bitrate (bps) = fileSize (bits) / duration (sec)
         1 チャンクの長さ (sec) = targetBytes (bits) / bitrate */
      const targetBytes      = mb * 1024 * 1024;
      const estimatedBps     = (file.size * 8) / duration;
      const chunkDurationSec = (targetBytes * 8) / estimatedBps;
      const numParts         = Math.ceil(duration / chunkDurationSec);

      addLog(`[info] duration=${duration.toFixed(2)}s  bitrate=${(estimatedBps/1000).toFixed(0)}kbps`);
      addLog(`[info] 1 チャンク ≈ ${chunkDurationSec.toFixed(2)}s  分割数=${numParts}`);

      /* 6. 分割実行 */
      const ext         = file.name.split(".").pop();
      const baseName    = file.name.slice(0, -(ext.length + 1));
      const outputFiles = [];

      for (let i = 0; i < numParts; i++) {
        const startSec    = i * chunkDurationSec;
        const outFileName = `${baseName}_part${String(i + 1).padStart(3, "0")}.${ext}`;
        const pct         = 25 + ((i / numParts) * 70);

        setProgress(`分割中... (${i + 1} / ${numParts})`, pct);
        addLog(`[split] part ${i + 1}/${numParts}: start=${startSec.toFixed(2)}s  output=${outFileName}`);

        // -c copy で無劣化コピー
        // -avoid_negative_ts make_zero で先頭タイムスタンプを 0 に正規化
        // 最後のチャンクは -t を省略して末尾まで含める
        const args = [
          "-ss", startSec.toFixed(6),
          "-i",  file.name,
          "-c",  "copy",
          "-avoid_negative_ts", "make_zero",
        ];

        // 最後のチャンク以外は長さを指定
        if (i < numParts - 1) {
          args.push("-t", chunkDurationSec.toFixed(6));
        }

        args.push(outFileName);

        await ffmpeg.run(...args);
        outputFiles.push(outFileName);
      }

      /* 7. ダウンロード */
      setProgress("ダウンロード中...", 97);
      addLog(`[info] ${outputFiles.length} ファイルをダウンロードします`);

      for (const name of outputFiles) {
        downloadFromFS(name, name);
        // 仮想 FS のメモリを解放
        try { ffmpeg.FS("unlink", name); } catch (_) {}
        // 連続ダウンロードをブラウザがブロックしないよう少し待つ
        await sleep(300);
      }

      // 元ファイルも解放
      try { ffmpeg.FS("unlink", file.name); } catch (_) {}

      /* 8. 完了表示 */
      setProgress("完了", 100);
      resultBody.textContent =
        `${outputFiles.length} 個のファイルに分割しました。\n` +
        outputFiles.map((n, i) => `  ${i + 1}. ${n}`).join("\n");
      resultCard.classList.add("visible");

    } catch (err) {
      console.error(err);
      errorBody.textContent = String(err.message || err);
      errorCard.classList.add("visible");
      addLog("[error] " + String(err.message || err));
    } finally {
      splitBtn.disabled = false;
    }
  });

  /* ---- ユーティリティ ---- */
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

})();
