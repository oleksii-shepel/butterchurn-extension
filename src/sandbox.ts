import butterchurn from 'butterchurn';
import butterchurnPresets from 'butterchurn-presets';

console.log('[Sandbox] Script loaded.');

interface VisualizerState {
    visualizer: any | null;
    // audioCtx: AudioContext | null; // Removed - no longer needed in sandbox
    // analyserNode: AnalyserNode | null; // Removed - no longer needed in sandbox
    isInitialized: boolean;
    // hasUserGesture: boolean; // Removed - sandbox no longer needs to create AudioContext
    presetsList: string[];
    presetsMap: Record<string, any>;
    currentPresetIndex: number;
    // pendingActions: Array<() => void>; // Removed - no longer queuing for AudioContext creation
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
    // audioCtx: null, // Removed
    // analyserNode: null, // Removed
    isInitialized: false,
    // hasUserGesture: false, // Removed
    presetsList: [],
    presetsMap: {},
    currentPresetIndex: 0,
    // pendingActions: [], // Removed
    pixelRatio: 1,
    resizeTimeout: null,
    mode: 'off',
};

let frequencyBarData: Uint8Array = new Uint8Array(1024);
let barAnimationFrame: number | null = null;
const NUM_BARS = 10;

// Player logo overlay element
let userHasInteractedWithLogo = true; // Track if user interacted to hide logo


const getCanvasEffectiveDimensions = (canvas: HTMLCanvasElement | null): { width: number; height: number } => {
    if (!canvas) {
        return { width: window.innerWidth, height: window.innerHeight };
    }
    // No need for `void canvas.offsetWidth;` here unless there's a specific rendering bug.
    // getBoundingClientRect() is often more reliable for actual rendered size.
    const rect = canvas.getBoundingClientRect();
    let width = rect.width;
    let height = rect.height;

    // Fallback if computed dimensions are zero
    if (width <= 0 || height <= 0) {
        if (canvas.parentElement) {
            const parent = canvas.parentElement;
            width = parent.clientWidth || parent.offsetWidth;
            height = parent.clientHeight || parent.offsetHeight;
        }
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

// Removed ensureAudioContext - Sandbox no longer manages AudioContext

// Removed queueForUserGesture and executePendingActions - no longer needed for AudioContext creation

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

// Note: The `audioSource` for butterchurn.createVisualizer will be null here,
// as the sandbox no longer has an AnalyserNode. Butterchurn can render
// without an audio source if you pass it the `params` directly later.
// The `butterchurn` library is flexible.
const setupVisualizer = (pixelRatio: number): boolean => {
    destroyVisualizer(); // Clean up any existing visualizer

    if (!butterchurnCanvas) {
        console.error('[Sandbox] Butterchurn canvas not found.');
        return false;
    }

    if (!checkWebGLSupport()) {
        console.error('[Sandbox] WebGL not supported. Butterchurn cannot be initialized.');
        return false;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    const safePixelRatio = Math.min(Math.max(pixelRatio || devicePixelRatio, 0.5), 3);
    state.pixelRatio = safePixelRatio;

    const dimensions = getCanvasEffectiveDimensions(butterchurnCanvas);
    butterchurnCanvas.width = dimensions.width;
    butterchurnCanvas.height = dimensions.height;

    if (butterchurnCanvas.width <= 0 || butterchurnCanvas.height <= 0) {
        console.error('[Sandbox] Invalid butterchurn canvas dimensions (width or height is zero or less).');
        return false;
    }

    // IMPORTANT: audioSource is null because the sandbox doesn't have an AnalyserNode.
    // Butterchurn will receive pre-processed `params` from the content script.
    const visualizerOptions = {
        audioSource: null, // No AnalyserNode in sandbox
        width: butterchurnCanvas.width,
        height: butterchurnCanvas.height,
        pixelRatio: state.pixelRatio,
    };

    try {
        state.visualizer = butterchurn.createVisualizer(null, butterchurnCanvas, visualizerOptions);
        // Ensure setRendererSize is called as per library docs, though options might set it.
        state.visualizer?.setRendererSize?.(butterchurnCanvas.width, butterchurnCanvas.height);

        // Load presets as usual
        state.presetsMap = butterchurnPresets.getPresets();
        state.presetsList = Object.keys(state.presetsMap);
        state.currentPresetIndex = 0;

        if (state.presetsList.length > 0 && state.presetsMap[state.presetsList[0]]) {
            state.visualizer.loadPreset(state.presetsMap[state.presetsList[0]]);
            console.log('[Sandbox] Loaded initial preset:', state.presetsList[0]);
        }

        setupClickListener(butterchurnCanvas);
        console.log('[Sandbox] Butterchurn visualizer setup completed.');
        return true;
    } catch (error) {
        console.error('[Sandbox] Butterchurn visualizer creation failed:', error);
        destroyVisualizer(); // Clean up if creation failed
        return false;
    }
};

const initializeButterchurn = (pixelRatio: number) => {
    if (state.isInitialized) {
        console.log('[Sandbox] Butterchurn already initialized.');
        return;
    }

    console.log('[Sandbox] Initializing Butterchurn...');
    if (!setupVisualizer(pixelRatio)) {
        console.error('[Sandbox] Butterchurn initialization failed.');
        cleanup();
        return;
    }

    state.isInitialized = true;
    console.log('[Sandbox] Butterchurn initialized successfully.');
};

const cleanup = () => {
    console.log('[Sandbox] Cleaning up sandbox resources...');
    destroyVisualizer();
    // Removed audioCtx closing - sandbox no longer owns one
    // No need to clear state.audioCtx or state.analyserNode anymore
    state.isInitialized = false;
    stopBars(); // Ensure bars animation is stopped
};

const drawBars = () => {
    if (!barsCanvas || !ctx || !frequencyBarData.length) {
        barAnimationFrame = null; // Ensure loop stops if conditions aren't met
        return;
    }

    const { width, height } = barsCanvas;
    ctx.clearRect(0, 0, width, height); // Clear the entire canvas for each frame

    const segmentSize = Math.floor(frequencyBarData.length / NUM_BARS);
    const barWidth = (width / NUM_BARS) * 0.8;
    const gap = (width / NUM_BARS) * 0.2;
    let x = 0;

    for (let i = 0; i < NUM_BARS; i++) {
        let sum = 0;
        const start = i * segmentSize;
        const end = start + segmentSize;

        // Sum values for the current bar segment
        for (let j = start; j < end; j++) {
            sum += frequencyBarData[j];
        }
        const avg = sum / segmentSize;
        const barHeight = (avg / 255) * height * 0.9; // Normalize avg (0-255) to canvas height, scale down slightly

        // Draw the bar
        ctx.fillStyle = `hsl(${(i * 360) / NUM_BARS}, 100%, 50%)`;
        ctx.fillRect(x, height - barHeight, barWidth, barHeight);

        x += barWidth + gap; // Move to the next bar position
    }

    barAnimationFrame = requestAnimationFrame(drawBars); // Request next frame
};

const stopBars = () => {
    if (barAnimationFrame !== null) {
        cancelAnimationFrame(barAnimationFrame);
        barAnimationFrame = null;
        console.log('[Sandbox] Stopped bars animation.');
    }
};

const safeResize = (width?: number, height?: number) => {
    // Debounce is handled externally by debouncedResize
    // This function performs the actual resize logic immediately.

    const resizeCanvas = (canvas: HTMLCanvasElement | null) => {
        if (!canvas) return;
        const newDimensions = width && height ? { width, height } : getCanvasEffectiveDimensions(canvas);

        if (canvas.width === newDimensions.width && canvas.height === newDimensions.height) {
            return; // No change needed
        }

        canvas.width = newDimensions.width;
        canvas.height = newDimensions.height;
        // console.log(`[Sandbox] Resized ${canvas.id} to ${canvas.width}x${canvas.height}`);
    };

    resizeCanvas(butterchurnCanvas);
    resizeCanvas(barsCanvas);

    if (state.visualizer && butterchurnCanvas) {
        // Butterchurn needs to be informed of its new dimensions
        state.visualizer.setRendererSize?.(butterchurnCanvas.width, butterchurnCanvas.height);
    }
};

const debouncedResize = () => {
    if (state.resizeTimeout) {
        clearTimeout(state.resizeTimeout);
    }
    state.resizeTimeout = window.setTimeout(() => {
        safeResize(); // Call safeResize without specific width/height, it will derive from DOM
        state.resizeTimeout = null;
    }, 100); // 100ms debounce
};

// Removed handleInitialUserGesture as sandbox no longer needs to create AudioContext directly.
// The content script ensures the AudioContext exists and sends data only after user gesture.

const switchMode = (mode: 'butterchurn' | 'bars' | 'off') => {
    if (state.mode === mode) return; // No change needed

    state.mode = mode;
    console.log(`[Sandbox] Switching to mode: ${mode}`);

    // Update canvas visibility and animation loops based on mode
    if (mode === 'butterchurn') {
        if (butterchurnCanvas) butterchurnCanvas.style.display = 'block';
        if (barsCanvas) barsCanvas.style.display = 'none';
        stopBars(); // Stop bars animation
    } else if (mode === 'bars') {
        if (barsCanvas) barsCanvas.style.display = 'block';
        if (butterchurnCanvas) butterchurnCanvas.style.display = 'none';
        startBars(); // Start bars animation
    } else { // mode === 'off'
        if (butterchurnCanvas) butterchurnCanvas.style.display = 'none';
        if (barsCanvas) barsCanvas.style.display = 'none';
        stopBars(); // Stop any active animation
    }
    // The AudioContext resume/suspend calls are handled by the content script.
    // The sandbox just reacts to the mode.
};

const startBars = () => {
    if (barAnimationFrame === null) {
        barAnimationFrame = requestAnimationFrame(drawBars);
    }
};

const handleMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    try {
        switch (data.type) {
            case 'INIT_BUTTERCHURN':
                // The content script should have already detected a user gesture
                // and initialized its AudioContext before sending this.
                // So, no need for `queueForUserGesture` here.
                initializeButterchurn(data.pixelRatio);
                break;

            case 'AUDIO_DATA':
                if (!data.mode) break;
                // Only switch mode if it's different to avoid redundant DOM updates
                if (state.mode !== data.mode) {
                    switchMode(data.mode);
                }

                if (data.mode === 'butterchurn') {
                    // Render Butterchurn with the parameters from the content script
                    state.visualizer?.render?.(data.params);
                } else if (data.mode === 'bars' && data.freqArray) {
                    // Update frequency data for bars mode
                    frequencyBarData = new Uint8Array(data.freqArray); // Create a new Uint8Array to prevent shared buffer issues
                                                                      // or potential memory leaks if data.freqArray is a transferable object that needs releasing.
                                                                      // This copies the data. If performance is an issue, consider Transferable Objects for freqArray.
                }
                break;

            case 'RESIZE_BUTTERCHURN':
                // `data.width` and `data.height` are likely already scaled by pixelRatio from content script
                safeResize(data.width / state.pixelRatio, data.height / state.pixelRatio);
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
// No initial user gesture listener in sandbox, as it no longer creates AudioContext
window.addEventListener('message', handleMessage);
window.addEventListener('resize', debouncedResize);
window.addEventListener('beforeunload', cleanup); // Ensures resources are released when iframe closes
window.addEventListener('load', () => {
    // Initially hide both canvases
    if (butterchurnCanvas) butterchurnCanvas.style.display = 'none';
    if (barsCanvas) barsCanvas.style.display = 'none';
    showLogo(!userHasInteractedWithLogo); // Show logo initially until user interaction
});