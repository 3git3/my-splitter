const { createFFmpeg, fetchFile } = FFmpeg;

class MediaSplitter {
  constructor() {
    this.ffmpeg = null;
    this.isLoaded = false;
    this.setupEventListeners();
  }

  async loadFFmpeg() {
    if (this.isLoaded) return;

    this.updateProgress("FFmpeg を読み込み中...", 0);
    this.ffmpeg = createFFmpeg({
      log: true,
      progress: ({ ratio }) => {
        // ratio: 0〜1
        const percent = Math.round(ratio * 100);
        this.updateProgress(`FFmpeg 読み込み中... ${percent}%`, percent);
      },
    });

    await this.ffmpeg.load();
    this.isLoaded = true;
    this.updateProgress("準備完了", 100);
  }

  updateProgress(text, percent) {
    document.getElementById('progressInfo').textContent = text;
    document.getElementById('progressFill').style.width = percent + '%';
  }

  setupEventListeners() {
    document.getElementById('splitBtn').addEventListener('click', () => {
      this.startSplit();
    });
  }

  async startSplit() {
    const fileInput = document.getElementById('fileInput');
    const mbInput = document.getElementById('mbInput');
    const btn = document.getElementById('splitBtn');

    const file = fileInput.files[0];
    if (!file) {
      alert('ファイルを選択してください');
      return;
    }

    const mb = parseInt(mbInput.value, 10);
    if (mb <= 0 || isNaN(mb)) {
      alert('MBは正の整数で指定してください');
      return;
    }

    btn.disabled = true;
    this.updateProgress("準備中...", 0);

    try {
      await this.loadFFmpeg();

      // ファイルを仮想ファイルシステムに書き込み
      this.updateProgress("ファイル読み込み中...", 10);
      this.ffmpeg.FS('writeFile', file.name, await fetchFile(file));

      // ファイルサイズ (MB)
      const fileSizeMB = file.size / (1024 * 1024);
      if (fileSizeMB <= mb) {
        alert(`ファイルサイズが ${mb}MB 以下です。分割の必要はありません。`);
        btn.disabled = false;
        return;
      }

      // 分割数を計算（ざっくり）
      const numParts = Math.ceil(fileSizeMB / mb);

      this.updateProgress(`分割中... (0/${numParts})`, 0);

      // ここでは簡易的に「ファイルを単純に分割」する例
      // 実際には ffprobe.wasm で長さを取得し、時間ベースで分割するのがベター
      for (let i = 0; i < numParts; i++) {
        const outName = `part${i + 1}_${file.name}`;

        // 実際には ffmpeg.wasm で -ss と -t を指定して時間ベースで分割する
        // ここでは簡易的に「ファイルをコピー」してるだけ（実用には不十分）
        await this.ffmpeg.run('-i', file.name, '-c', 'copy', outName);

        this.updateProgress(`分割中... (${i + 1}/${numParts})`, ((i + 1) / numParts) * 100);
      }

      this.updateProgress("分割完了", 100);

      // 分割ファイルをダウンロードリンクとして表示（簡易）
      alert(`分割が完了しました。\nブラウザの開発者ツールのコンソールに出力ファイル名が表示されます。`);
      console.log('分割ファイル名:', this.ffmpeg.FS('readdir', '/'));

    } catch (err) {
      console.error(err);
      alert('エラーが発生しました: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }
}

// アプリ起動
new MediaSplitter();