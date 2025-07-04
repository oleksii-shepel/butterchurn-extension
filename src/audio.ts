import FFT from "./fft";

export type AudioLevels = {
  timeByteArray: Uint8Array;
  timeByteArrayL: Uint8Array;
  timeByteArrayR: Uint8Array;
};

export type RenderParams = {
  audioLevels?: AudioLevels;
  elapsedTime?: number;
};

export default class AudioProcessor {
  private numSamps: number;
  private fftSize: number;
  private fft: FFT;

  private audioContext?: AudioContext;
  private audible?: DelayNode;
  private analyser?: AnalyserNode;
  private analyserL?: AnalyserNode;
  private analyserR?: AnalyserNode;
  private splitter?: ChannelSplitterNode;

  public timeByteArray: Uint8Array;
  public timeByteArrayL: Uint8Array;
  public timeByteArrayR: Uint8Array;

  public timeArray: Int8Array;
  public timeByteArraySignedL: Int8Array;
  public timeByteArraySignedR: Int8Array;

  private tempTimeArrayL: Int8Array;
  private tempTimeArrayR: Int8Array;

  public timeArrayL: Int8Array;
  public timeArrayR: Int8Array;

  public freqArray?: Float32Array;
  public freqArrayL?: Float32Array;
  public freqArrayR?: Float32Array;

  constructor(context?: AudioContext) {
    this.numSamps = 512;
    this.fftSize = this.numSamps * 2;

    this.fft = new FFT(this.fftSize, 512, true);

    if (context) {
      this.audioContext = context;
      this.audible = context.createDelay();

      this.analyser = context.createAnalyser();
      this.analyser.smoothingTimeConstant = 0.0;
      this.analyser.fftSize = this.fftSize;
      this.audible.connect(this.analyser);

      this.analyserL = context.createAnalyser();
      this.analyserL.smoothingTimeConstant = 0.0;
      this.analyserL.fftSize = this.fftSize;

      this.analyserR = context.createAnalyser();
      this.analyserR.smoothingTimeConstant = 0.0;
      this.analyserR.fftSize = this.fftSize;

      this.splitter = context.createChannelSplitter(2);
      this.audible.connect(this.splitter);
      this.splitter.connect(this.analyserL, 0);
      this.splitter.connect(this.analyserR, 1);
    }

    this.timeByteArray = new Uint8Array(this.fftSize);
    this.timeByteArrayL = new Uint8Array(this.fftSize);
    this.timeByteArrayR = new Uint8Array(this.fftSize);

    this.timeArray = new Int8Array(this.fftSize);
    this.timeByteArraySignedL = new Int8Array(this.fftSize);
    this.timeByteArraySignedR = new Int8Array(this.fftSize);

    this.tempTimeArrayL = new Int8Array(this.fftSize);
    this.tempTimeArrayR = new Int8Array(this.fftSize);

    this.timeArrayL = new Int8Array(this.numSamps);
    this.timeArrayR = new Int8Array(this.numSamps);
  }

  public getRenderParams(): RenderParams {
    return {
      audioLevels: {
        timeByteArray: this.timeByteArray,
        timeByteArrayL: this.timeByteArrayL,
        timeByteArrayR: this.timeByteArrayR
      },
      elapsedTime: this.audioContext?.currentTime
    };
  }

  public sampleAudio(): void {
    this.analyser?.getByteTimeDomainData(this.timeByteArray);
    this.analyserL?.getByteTimeDomainData(this.timeByteArrayL);
    this.analyserR?.getByteTimeDomainData(this.timeByteArrayR);
    this.processAudio();
  }

  public updateAudio(
    timeByteArray: Uint8Array,
    timeByteArrayL: Uint8Array,
    timeByteArrayR: Uint8Array
  ): void {
    this.timeByteArray.set(timeByteArray);
    this.timeByteArrayL.set(timeByteArrayL);
    this.timeByteArrayR.set(timeByteArrayR);
    this.processAudio();
  }

  /* eslint-disable no-bitwise */
  private processAudio(): void {
    for (let i = 0, j = 0, lastIdx = 0; i < this.fftSize; i++) {
      this.timeArray[i] = this.timeByteArray[i] - 128;
      this.timeByteArraySignedL[i] = this.timeByteArrayL[i] - 128;
      this.timeByteArraySignedR[i] = this.timeByteArrayR[i] - 128;

      this.tempTimeArrayL[i] =
        0.5 * (this.timeByteArraySignedL[i] + this.timeByteArraySignedL[lastIdx]);
      this.tempTimeArrayR[i] =
        0.5 * (this.timeByteArraySignedR[i] + this.timeByteArraySignedR[lastIdx]);

      if (i % 2 === 0) {
        this.timeArrayL[j] = this.tempTimeArrayL[i];
        this.timeArrayR[j] = this.tempTimeArrayR[i];
        j += 1;
      }

      lastIdx = i;
    }

    this.freqArray = this.fft.timeToFrequencyDomain(new Float32Array(this.timeArray));
    this.freqArrayL = this.fft.timeToFrequencyDomain(new Float32Array(this.timeByteArraySignedL));
    this.freqArrayR = this.fft.timeToFrequencyDomain(new Float32Array(this.timeByteArraySignedR));
  }

  public connectAudio(audioNode: AudioNode): void {
    if (this.audible) {
      audioNode.connect(this.audible);
    }
  }

  public disconnectAudio(audioNode: AudioNode): void {
    if (this.audible) {
      audioNode.disconnect(this.audible);
    }
  }
  /* eslint-enable no-bitwise */
}
