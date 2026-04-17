document.addEventListener('DOMContentLoaded', () => {
  const { createFFmpeg, fetchFile } = FFmpeg;

  // FFmpeg の初期化（corePath をローカルに固定）
  const ffmpeg = createFFmpeg({
    log: true,
    corePath: './ffmpeg-core.js?v=4'
  });

  const fileInput = document.getElementById('file-input');
  const fileInfo = document.getElementById('file-info');
  const mbInput = document.getElementById('mb-input');
  const splitBtn = document.getElementById('split-btn');
  const progressCard = document.getElementById('progress-card');
  const progText = document.getElementById('prog-text');
  const progPct = document.getElementById('prog-pct');
  const progFill = document.getElementById('prog-fill');
  const logBox = document.getElementById('log-box');
  const resultCard = document.getElementById('result-card');
  const resultBody = document.getElementById('result-body');

  let targetFile = null;

  function addLog(msg) {
    logBox.textContent += msg + '\n';
    logBox.scrollTop = logBox.scrollHeight;
  }

  function setProgress(text, pct) {
    progText.textContent = text;
    progPct.textContent = Math.round(pct) + '%';
    progFill.style.width = pct + '%';
  }

  fileInput.addEventListener('change', (e) => {
    targetFile = e.target.files[0];
    if (!targetFile) {
      fileInfo.classList.add('hidden');
      splitBtn.disabled = true;
      return;
    }
    const mb = (targetFile.size / 1024 / 1024).toFixed(2);
    fileInfo.textContent = `選択中: ${targetFile.name} (${mb} MB)`;
    fileInfo.classList.remove('hidden');
    splitBtn.disabled = false;
  });

  function createDownloadLink(fileName, data) {
    const url = URL.createObjectURL(new Blob([data.buffer]));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.textContent = `⬇️ ${fileName} をダウンロード`;
    a.style.display = 'block';
    a.style.marginTop = '10px';
    resultBody.appendChild(a);
  }

  splitBtn.addEventListener('click', async () => {
    if (!targetFile) return;

    const targetMB = parseFloat(mbInput.value);
    if (isNaN(targetMB) || targetMB <= 0) {
      alert("正しいMBを入力してください");
      return;
    }

    splitBtn.disabled = true;
    progressCard.classList.remove('hidden');
    resultCard.classList.add('hidden');
    resultBody.innerHTML = '';
    logBox.textContent = '';

    try {
      if (!ffmpeg.isLoaded()) {
        setProgress('FFmpegモジュールを読み込み中...', 10);
        await ffmpeg.load();
      }

      setProgress('ファイルを読み込み中...', 20);
      ffmpeg.FS('writeFile', 'input', await fetchFile(targetFile));

      setProgress('動画の長さを解析中...', 30);
      let duration = 0;

      ffmpeg.setLogger(({ message }) => {
        addLog(message);
        const match = message.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        if (match) {
          duration =
            parseInt(match[1]) * 3600 +
            parseInt(match[2]) * 60 +
            parseFloat(match[3]);
        }
      });

      await ffmpeg.run('-i', 'input');

      if (duration === 0) {
        throw new Error("動画の長さを取得できませんでした。");
      }

      addLog(`[info] 動画の長さ: ${duration}秒`);

      const targetBytes = targetMB * 1024 * 1024;
      const bitRate = (targetFile.size * 8) / duration;
      const chunkSec = (targetBytes * 8) / bitRate;
      const numParts = Math.ceil(duration / chunkSec);

      const ext = targetFile.name.split('.').pop();
      const baseName = targetFile.name.replace(`.${ext}`, '');

      addLog(`[info] 概算 ${numParts} 分割します (約 ${chunkSec.toFixed(2)} 秒ごと)`);

      for (let i = 0; i < numParts; i++) {
        const outName = `${baseName}_part${i + 1}.${ext}`;
        const startSec = i * chunkSec;

        const pct = 30 + ((i / numParts) * 60);
        setProgress(`分割中... (${i + 1} / ${numParts})`, pct);
        addLog(`[split] ${outName} を作成中...`);

        await ffmpeg.run(
          '-ss', startSec.toString(),
          '-i', 'input',
          '-t', chunkSec.toString(),
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          outName
        );

        const data = ffmpeg.FS('readFile', outName);
        createDownloadLink(outName, data);

        ffmpeg.FS('unlink', outName);
      }

      ffmpeg.FS('unlink', 'input');

      setProgress('完了！', 100);
      resultCard.classList.remove('hidden');

    } catch (err) {
      console.error(err);
      addLog(`[Error] ${err.message}`);
      setProgress('エラーが発生しました', 0);
      progFill.style.background = 'red';
    } finally {
      splitBtn.disabled = false;
    }
  });
});
