import butterchurn from 'butterchurn';
import butterchurnPresets from 'butterchurn-presets';

console.log('[Sandbox] Script loaded.');

interface VisualizerState {
  visualizer: any | null;
  audioCtx: AudioContext | null;
  analyserNode: AnalyserNode | null;
  isInitialized: boolean;
  hasUserGesture: boolean;
  presetsList: string[];
  presetsMap: Record<string, any>;
  currentPresetIndex: number;
  pendingActions: Array<() => void>;
  pixelRatio: number;
  resizeTimeout: number | null;
  mode: 'butterchurn' | 'bars' | 'off';
}

// Separate canvas references for WebGL and 2D bars
const butterchurnCanvas = document.getElementById('butterchurn-canvas') as HTMLCanvasElement | null;
const barsCanvas = document.getElementById('bars-canvas') as HTMLCanvasElement | null;
const ctx = barsCanvas?.getContext('2d');

const state: VisualizerState = {
  visualizer: null,
  audioCtx: null,
  analyserNode: null,
  isInitialized: false,
  hasUserGesture: false,
  presetsList: [],
  presetsMap: {},
  currentPresetIndex: 0,
  pendingActions: [],
  pixelRatio: 1,
  resizeTimeout: null,
  mode: 'off',
};

let frequencyBarData: Uint8Array = new Uint8Array(0);
let barAnimationFrame: number | null = null;
const NUM_BARS = 10;

// Player logo overlay element
const logo = document.getElementById('player-logo-overlay');
let userHasInteractedWithLogo = false; // Track if user interacted to hide logo

const showLogo = (show: boolean) => {
  if (!logo) return;
  logo.classList.toggle('hidden', !show);
};

const hideLogoOnUserInteraction = () => {
  if (!logo || userHasInteractedWithLogo) return;
  userHasInteractedWithLogo = true;
  showLogo(false);
  removeInteractionListeners();
};

const addInteractionListeners = () => {
  document.body.addEventListener('click', hideLogoOnUserInteraction);
  window.addEventListener('keydown', hideLogoOnUserInteraction);
  window.addEventListener('touchstart', hideLogoOnUserInteraction);
};

const removeInteractionListeners = () => {
  document.body.removeEventListener('click', hideLogoOnUserInteraction);
  window.removeEventListener('keydown', hideLogoOnUserInteraction);
  window.removeEventListener('touchstart', hideLogoOnUserInteraction);
};

addInteractionListeners();

const getCanvasEffectiveDimensions = (canvas: HTMLCanvasElement | null): { width: number; height: number } => {
  if (!canvas) {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  void canvas.offsetWidth;
  let width = canvas.offsetWidth || canvas.clientWidth;
  let height = canvas.offsetHeight || canvas.clientHeight;

  if ((width <= 0 || height <= 0) && canvas.parentElement) {
    const parent = canvas.parentElement;
    width = parent.clientWidth || parent.offsetWidth;
    height = parent.clientHeight || parent.offsetHeight;
  }

  if (width <= 0 || height <= 0) {
    width = window.innerWidth || 564;
    height = window.innerHeight || 287;
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
};

const checkWebGLSupport = (): boolean => {
  try {
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
    return !!gl;
  } catch (e) {
    console.error('[Sandbox] WebGL not supported:', e);
    return false;
  }
};

const ensureAudioContext = async (): Promise<boolean> => {
  if (!state.hasUserGesture) {
    console.warn('[Sandbox] Cannot create/resume AudioContext without user gesture');
    return false;
  }

  try {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log('[Sandbox] AudioContext created.');
    }

    if (state.audioCtx.state === 'suspended') {
      await state.audioCtx.resume();
      console.log('[Sandbox] AudioContext resumed.');
    }

    if (!state.analyserNode) {
      state.analyserNode = state.audioCtx.createAnalyser();
      state.analyserNode.fftSize = 1024;
      console.log('[Sandbox] AnalyserNode created.');
    }

    return true;
  } catch (error) {
    console.error('[Sandbox] Failed to ensure AudioContext:', error);
    return false;
  }
};

const queueForUserGesture = (action: () => void) => {
  state.hasUserGesture ? action() : state.pendingActions.push(action);
};

const executePendingActions = () => {
  for (const action of state.pendingActions) {
    try {
      action();
    } catch (error) {
      console.error('[Sandbox] Error executing pending action:', error);
    }
  }
  state.pendingActions = [];
};

const loadRandomPreset = () => {
  if (state.presetsList.length === 0 || !state.visualizer) {
    console.warn('[Sandbox] No presets available or visualizer not ready.');
    return;
  }

  state.currentPresetIndex = Math.floor(Math.random() * state.presetsList.length);
  const presetName = state.presetsList[state.currentPresetIndex];
  const preset = state.presetsMap[presetName];

  if (preset) {
    try {
      state.visualizer.loadPreset(preset);
      console.log(`[Sandbox] Loaded random preset: ${presetName}`);
    } catch (error) {
      console.error('[Sandbox] Error loading preset:', error);
    }
  }
};

const setupClickListener = (canvas: HTMLCanvasElement | null) => {
  if (!canvas) return;
  canvas.style.cursor = 'pointer';
  canvas.addEventListener('click', loadRandomPreset);
};

const destroyVisualizer = () => {
  if (state.visualizer) {
    try {
      if (typeof state.visualizer.destroy === 'function') {
        state.visualizer.destroy();
        console.log('[Sandbox] Visualizer destroyed.');
      }
    } catch (error) {
      console.warn('[Sandbox] Error destroying visualizer:', error);
    } finally {
      state.visualizer = null;
    }
  }
};

const setupVisualizer = (pixelRatio: number): boolean => {
  destroyVisualizer();

  if (!butterchurnCanvas || !state.audioCtx) {
    console.error('[Sandbox] Visualizer setup preconditions not met.');
    return false;
  }

  if (!checkWebGLSupport()) {
    console.error('[Sandbox] WebGL not supported.');
    return false;
  }

  const devicePixelRatio = window.devicePixelRatio || 1;
  const safePixelRatio = Math.min(Math.max(pixelRatio || devicePixelRatio, 0.5), 3);
  state.pixelRatio = safePixelRatio;

  const dimensions = getCanvasEffectiveDimensions(butterchurnCanvas);
  butterchurnCanvas.width = dimensions.width;
  butterchurnCanvas.height = dimensions.height;

  if (butterchurnCanvas.width <= 0 || butterchurnCanvas.height <= 0) {
    console.error('[Sandbox] Invalid canvas dimensions.');
    return false;
  }

  const visualizerOptions = {
    audioSource: state.analyserNode,
    width: butterchurnCanvas.width,
    height: butterchurnCanvas.height,
    pixelRatio: state.pixelRatio,
  };

  try {
    state.visualizer = butterchurn.createVisualizer(state.audioCtx, butterchurnCanvas, visualizerOptions);
    state.visualizer?.setRendererSize?.(butterchurnCanvas.width, butterchurnCanvas.height);

    state.presetsMap = butterchurnPresets.getPresets();
    state.presetsList = Object.keys(state.presetsMap);
    state.currentPresetIndex = 0;

    if (state.presetsList.length > 0 && state.presetsMap[state.presetsList[0]]) {
      state.visualizer.loadPreset(state.presetsMap[state.presetsList[0]]);
      console.log('[Sandbox] Loaded initial preset:', state.presetsList[0]);
    }

    setupClickListener(butterchurnCanvas);
    console.log('[Sandbox] Visualizer setup completed.');
    return true;
  } catch (error) {
    console.error('[Sandbox] Visualizer creation failed:', error);
    destroyVisualizer();
    return false;
  }
};

const initializeButterchurn = async (pixelRatio: number) => {
  if (state.isInitialized) return;

  console.log('[Sandbox] Initializing Butterchurn...');
  if (!(await ensureAudioContext()) || !setupVisualizer(pixelRatio)) {
    console.error('[Sandbox] Initialization failed.');
    cleanup();
    return;
  }

  state.isInitialized = true;
  console.log('[Sandbox] Butterchurn initialized successfully.');
};

const cleanup = () => {
  console.log('[Sandbox] Cleaning up...');
  destroyVisualizer();
  if (state.audioCtx) {
    state.audioCtx.close().catch((e) => console.error('[Sandbox] Error closing AudioContext:', e));
    state.audioCtx = null;
  }
  state.analyserNode = null;
  state.isInitialized = false;
};

const drawBars = () => {
  if (!barsCanvas || !frequencyBarData.length) return;

  const { width, height } = barsCanvas;
  ctx!.clearRect(0, 0, width, height);

  const segmentSize = Math.floor(frequencyBarData.length / NUM_BARS);
  const barWidth = (width / NUM_BARS) * 0.8;
  const gap = (width / NUM_BARS) * 0.2;
  let x = 0;

  for (let i = 0; i < NUM_BARS; i++) {
    let sum = 0;
    const start = i * segmentSize;
    const end = start + segmentSize;

    for (let j = start; j < end; j++) {
      sum += frequencyBarData[j];
    }
    const avg = sum / segmentSize;
    const barHeight = avg * 0.8;

    ctx!.fillStyle = `hsl(${(i * 360) / NUM_BARS}, 100%, 50%)`;
    ctx!.fillRect(x, height - barHeight, barWidth, barHeight);

    x += barWidth + gap;
  }

  barAnimationFrame = requestAnimationFrame(drawBars);
};

const stopBars = () => {
  if (barAnimationFrame !== null) {
    cancelAnimationFrame(barAnimationFrame);
    barAnimationFrame = null;
  }
};

const safeResize = (width?: number, height?: number) => {
  // Resize both canvases if needed
  const resizeCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const newDimensions = width && height ? { width, height } : getCanvasEffectiveDimensions(canvas);

    if (canvas.width === newDimensions.width && canvas.height === newDimensions.height) return;

    canvas.width = newDimensions.width;
    canvas.height = newDimensions.height;
  };

  resizeCanvas(butterchurnCanvas);
  resizeCanvas(barsCanvas);

  if (state.visualizer && butterchurnCanvas) {
    state.visualizer.setRendererSize?.(butterchurnCanvas.width, butterchurnCanvas.height);
  }
};

const debouncedResize = () => {
  if (state.resizeTimeout) {
    clearTimeout(state.resizeTimeout);
  }
  state.resizeTimeout = window.setTimeout(() => {
    safeResize();
    state.resizeTimeout = null;
  }, 100); // 100ms debounce for better UX
};

const handleInitialUserGesture = async () => {
  const logo = document.getElementById('player-logo-overlay');
  logo && logo.classList.add('hidden');

  console.log('[Sandbox] User gesture detected.');
  document.removeEventListener('click', handleInitialUserGesture);
  document.removeEventListener('keydown', handleInitialUserGesture);

  state.hasUserGesture = true;
  executePendingActions();
};

const switchMode = (mode: 'butterchurn' | 'bars' | 'off') => {
  state.mode = mode;

  if (mode === 'butterchurn') {
    if (butterchurnCanvas) {
      butterchurnCanvas.style.display = 'block';
      barsCanvas && (barsCanvas.style.display = 'none');
      showLogo(!userHasInteractedWithLogo);
    }
    stopBars();
    state.audioCtx?.resume().catch((e) => console.error('[Sandbox] AudioContext resume error:', e));
  } else if (mode === 'bars') {
    if (barsCanvas) {
      barsCanvas.style.display = 'block';
      butterchurnCanvas && (butterchurnCanvas.style.display = 'none');
      showLogo(false);
    }
    drawBars();
    state.audioCtx?.resume().catch((e) => console.error('[Sandbox] AudioContext resume error:', e));
  } else {
    if (butterchurnCanvas) butterchurnCanvas.style.display = 'none';
    if (barsCanvas) barsCanvas.style.display = 'none';
    stopBars();
    showLogo(false);
    state.audioCtx?.suspend().catch((e) => console.error('[Sandbox] AudioContext suspend error:', e));
  }
};

const handleMessage = (event: MessageEvent) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  try {
    switch (data.type) {
      case 'INIT_BUTTERCHURN':
        queueForUserGesture(() => initializeButterchurn(data.pixelRatio));
        break;

      case 'AUDIO_DATA':
        if (!data.mode) break;
        switchMode(data.mode);
        if (data.mode === 'butterchurn') {
          state.visualizer?.render?.(data.params);
        } else if (data.mode === 'bars' && data.freqArray) {
          frequencyBarData = data.freqArray;
        }
        break;

      case 'RESIZE_BUTTERCHURN':
        safeResize(data.width, data.height);
        break;

      case 'CONTROL':
        if (data.mode) switchMode(data.mode);
        break;

      default:
        break;
    }
  } catch (error) {
    console.error(`[Sandbox] Message handler error for type ${data.type}:`, error);
  }
};

// --- Event Listeners ---
document.addEventListener('click', handleInitialUserGesture, { once: true });
document.addEventListener('keydown', handleInitialUserGesture, { once: true });
window.addEventListener('message', handleMessage);
window.addEventListener('resize', debouncedResize);
window.addEventListener('beforeunload', cleanup);
window.addEventListener('load', () => {
  // Initially hide both canvases
  if (butterchurnCanvas) butterchurnCanvas.style.display = 'none';
  if (barsCanvas) barsCanvas.style.display = 'none';
});
