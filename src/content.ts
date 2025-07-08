import AudioProcessor from './audio';

console.log('[Content Script] Loaded in YouTube iframe');

let video: HTMLVideoElement | null = null;
let player: HTMLElement | null = null;
let audioCtx: AudioContext | null = null;
let processor: AudioProcessor | null = null;
let sandboxIframe: HTMLIFrameElement | null = null;
let sandboxReady = false;

let currentMode: 'butterchurn' | 'bars' | 'off' = 'off';
let lastDataTime = 0;
const DATA_THROTTLE_MS = 16;

// 👇 Only safe visual hiding styles
const hidePlayerStyles = {
  width: '1px',
  height: '1px',
  opacity: '0.01',
  pointerEvents: 'none',
  transform: 'none',
};
const showPlayerStyles = {
  width: '',
  height: '',
  opacity: '',
  pointerEvents: '',
  transform: '',
};

function initializeSandbox() {
  if (sandboxIframe) return;

  sandboxIframe = document.createElement('iframe');
  sandboxIframe.src = chrome.runtime.getURL('sandbox.html');

  Object.assign(sandboxIframe.style, {
    position: 'absolute',
    bottom: '0',
    left: '0',
    width: '100%',
    height: '100%',
    zIndex: '9999',
    border: 'none',
    pointerEvents: 'auto',
    background: 'rgba(0,0,0,0.2)',
    display: 'none'
  });

  document.body.appendChild(sandboxIframe);

  sandboxIframe.onload = () => {
    console.log('[Content Script] Sandbox iframe loaded.');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!sandboxIframe?.contentWindow) return;
        const rect = sandboxIframe.getBoundingClientRect();

        sandboxIframe.contentWindow.postMessage({
          type: 'INIT_BUTTERCHURN',
          width: rect.width * devicePixelRatio,
          height: rect.height * devicePixelRatio,
          pixelRatio: devicePixelRatio
        }, '*');

        sandboxReady = true;
      });
    });
  };

  window.addEventListener('resize', () => {
    if (!sandboxIframe?.contentWindow || !sandboxReady) return;
    const rect = sandboxIframe.getBoundingClientRect();
    sandboxIframe.contentWindow.postMessage({
      type: 'RESIZE_BUTTERCHURN',
      width: rect.width * devicePixelRatio,
      height: rect.height * devicePixelRatio,
      pixelRatio: devicePixelRatio
    }, '*');
  });
}

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (event.origin !== window.origin && !event.origin.startsWith('http://localhost:8100')) return;

  if (data.type === 'CONTROL') {
    console.log('[Content Script] Received CONTROL:', data);
    currentMode = data.mode;

    const show = currentMode === 'butterchurn' || currentMode === 'bars';

    if (player?.style) {
      Object.assign(player.style, show ? hidePlayerStyles : showPlayerStyles);
    }

    sandboxIframe?.style && (sandboxIframe.style.display = show ? 'block' : 'none');

    if (show) audioCtx?.resume();
    else audioCtx?.suspend();

    sandboxIframe?.contentWindow?.postMessage(data, '*');
  }
});

function updateFrequencyData(analyser: AnalyserNode, freqData: Uint8Array) {
  if (!analyser) return;

  audioCtx?.resume();

  if (analyser.context.state === 'running') {
    analyser.getByteFrequencyData(freqData);
  } else {
    freqData.fill(0);
  }
}

function setupAudio(videoEl: HTMLVideoElement) {
  audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  processor = new AudioProcessor(audioCtx);

  const src = audioCtx.createMediaElementSource(videoEl);
  src.connect(audioCtx.destination);
  processor.connectAudio(src);

  const testAnalyser = audioCtx.createAnalyser();
  src.connect(testAnalyser);
  testAnalyser.fftSize = 1024;

  initializeSandbox();

  function sendAudioDataLoop() {
    requestAnimationFrame(sendAudioDataLoop);
    if (!sandboxReady || !sandboxIframe?.contentWindow || !processor) return;

    const now = performance.now();
    const throttle = currentMode === 'off' ? 250 : DATA_THROTTLE_MS;
    if (now - lastDataTime < throttle) return;

    if (currentMode !== 'off') {
      processor.sampleAudio();

      if (currentMode === 'butterchurn') {
        const params = processor.getRenderParams();
        sandboxIframe.contentWindow.postMessage({
          type: 'AUDIO_DATA',
          mode: currentMode,
          params
        }, '*');
      } else if (currentMode === 'bars') {
        const freqData = new Uint8Array(testAnalyser.frequencyBinCount);
        updateFrequencyData(testAnalyser, freqData);
        sandboxIframe.contentWindow.postMessage({
          type: 'AUDIO_DATA',
          mode: currentMode,
          freqArray: freqData
        }, '*');
      }
    }

    lastDataTime = now;
  }

  sendAudioDataLoop();

  const resumeAudio = () => {
    if (audioCtx?.state === 'suspended') {
      audioCtx.resume().then(() => {
        console.log('[Content Script] AudioContext resumed.');
      }).catch(err => {
        console.error('[Content Script] Failed to resume AudioContext:', err);
      });
    }
  };

  window.addEventListener('click', resumeAudio, { once: true });
  window.addEventListener('keydown', resumeAudio, { once: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log('[Content Script] Document hidden - suspending audio');
      audioCtx?.suspend().catch(console.error);
    } else {
      console.log('[Content Script] Document visible - resuming audio');
      audioCtx?.resume().catch(console.error);
    }
  });

  // 💡 Periodically attempt to resume audio context
  setInterval(() => {
    if (audioCtx?.state === 'suspended') {
      console.warn('[Content Script] AudioContext suspended – trying to resume');
      audioCtx.resume().catch(console.error);
    }
  }, 5000);
}

function waitForVideoElement(callback: (video: HTMLVideoElement, player: HTMLElement) => void) {
  const check = () => {
    const el = document.querySelector('video');
    const pl = document.querySelector('.html5-video-player');
    if (el instanceof HTMLVideoElement && pl instanceof HTMLElement) {
      console.log('[Content Script] Video element found');
      callback(el, pl);
      return true;
    }
    return false;
  };

  if (check()) return;

  const observer = new MutationObserver(() => {
    if (check()) observer.disconnect();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[Content Script] Waiting for video element...');
}

// 🚨 Watch for video node being replaced by YouTube
const observeVideoReplacement = () => {
  const observer = new MutationObserver(() => {
    const newVideo = document.querySelector('video');
    if (newVideo instanceof HTMLVideoElement && newVideo !== video) {
      console.warn('[Content Script] Video element replaced. Reinitializing audio.');
      audioCtx?.close();
      setupAudio(newVideo);
      video = newVideo;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
};

waitForVideoElement((vid, pl) => {
  video = vid;
  player = pl;
  setupAudio(video);
  observeVideoReplacement();
});
