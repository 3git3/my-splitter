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

  // ffprobe相当の機能で duration を取得（簡易版）
  async getFileDuration(fileName) {
    // ffmpeg.wasm のログから duration を抽出する簡易実装
    // 実際には ffprobe.wasm を使うのが望ましいが、ここでは簡易的にログから取得
    let duration = null;
    const originalLog = this.ffmpeg.setLogger(({ type, message }) => {
      if (type === 'fferr') {
        // Duration: 00:05:30.12 のような行を探す
        const match = message.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
        if (match) {
          const hours = parseInt(match[1], 10);
          const minutes = parseInt(match[2], 10);
          const seconds = parseFloat(match[3]);
          duration = hours * 3600 + minutes * 60 + seconds;
        }
      }
    });

    try {
      // 無音・無画質の短い出力を生成してログから duration を取得
      await this.ffmpeg.run('-i', fileName, '-f', 'null', '-');
    } catch (e) {
      // エラーでもログは出るので無視
    }

    this.ffmpeg.setLogger(originalLog);
    return duration;
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

      // duration を取得
      this.updateProgress("ファイル情報取得中...", 20);
      const duration = await this.getFileDuration(file.name);
      if (!duration) {
        alert('ファイルの長さを取得できませんでした。別のファイルをお試しください。');
        btn.disabled = false;
        return;
      }

      // 1MBあたりの秒数を計算
      const secPerMB = duration / fileSizeMB;
      const targetDurationSec = mb * secPerMB;

      // 分割数
      const numParts = Math.ceil(duration / targetDurationSec);

      this.updateProgress(`分割中... (0/${numParts})`, 0);

      for (let i = 0; i < numParts; i++) {
        const startTime = i * targetDurationSec;
        const outName = `part${i + 1}_${file.name}`;

        // 最後の分割は残り時間をそのまま使う
        const currentDuration = (i === numParts - 1)
          ? duration - startTime
          : targetDurationSec;

        await this.ffmpeg.run(
          '-i', file.name,
          '-ss', startTime.toString(),
          '-t', currentDuration.toString(),
          '-c', 'copy', // 無劣化コピー
          '-avoid_negative_ts', 'make_zero',
          outName
        );

        this.updateProgress(`分割中... (${i + 1}/${numParts})`, ((i + 1) / numParts) * 100);
      }

      this.updateProgress("分割完了", 100);

      // 仮想ファイルシステム内のファイル一覧を表示（確認用）
      const files = this.ffmpeg.FS('readdir', '/');
      const outputFiles = files.filter(f => f.startsWith('part'));
      console.log('分割されたファイル:', outputFiles);

      alert(`分割が完了しました。\nコンソールに出力ファイル名が表示されています。`);

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
