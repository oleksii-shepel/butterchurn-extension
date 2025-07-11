export default class FFT {
  private samplesIn: number;
  private samplesOut: number;
  private equalize: boolean;
  private NFREQ: number;
  private equalizeArr?: Float32Array;
  private bitrevtable!: Uint16Array;
  private cossintable!: [Float32Array, Float32Array];

  constructor(samplesIn: number, samplesOut: number, equalize: boolean = false) {
    this.samplesIn = samplesIn;
    this.samplesOut = samplesOut;
    this.equalize = equalize;
    this.NFREQ = samplesOut * 2;

    if (this.equalize) {
      this.initEqualizeTable();
    }

    this.initBitRevTable();
    this.initCosSinTable();
  }

  private initEqualizeTable(): void {
    this.equalizeArr = new Float32Array(this.samplesOut);
    const invHalfNFREQ = 1.0 / this.samplesOut;
    for (let i = 0; i < this.samplesOut; i++) {
      this.equalizeArr[i] = -0.02 * Math.log((this.samplesOut - i) * invHalfNFREQ);
    }
  }

  /* eslint-disable no-bitwise */
  private initBitRevTable(): void {
    this.bitrevtable = new Uint16Array(this.NFREQ);
    for (let i = 0; i < this.NFREQ; i++) {
      this.bitrevtable[i] = i;
    }

    let j = 0;
    for (let i = 0; i < this.NFREQ; i++) {
      if (j > i) {
        const temp = this.bitrevtable[i];
        this.bitrevtable[i] = this.bitrevtable[j];
        this.bitrevtable[j] = temp;
      }

      let m = this.NFREQ >> 1;
      while (m >= 1 && j >= m) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }
  }

  private initCosSinTable(): void {
    let dftsize = 2;
    let tabsize = 0;
    while (dftsize <= this.NFREQ) {
      tabsize += 1;
      dftsize <<= 1;
    }

    this.cossintable = [new Float32Array(tabsize), new Float32Array(tabsize)];

    dftsize = 2;
    let i = 0;
    while (dftsize <= this.NFREQ) {
      const theta = (-2.0 * Math.PI) / dftsize;
      this.cossintable[0][i] = Math.cos(theta);
      this.cossintable[1][i] = Math.sin(theta);
      i += 1;
      dftsize <<= 1;
    }
  }

  public timeToFrequencyDomain(waveDataIn: Float32Array): Float32Array {
    const real = new Float32Array(this.NFREQ);
    const imag = new Float32Array(this.NFREQ);

    for (let i = 0; i < this.NFREQ; i++) {
      const idx = this.bitrevtable[i];
      real[i] = idx < this.samplesIn ? waveDataIn[idx] : 0;
      imag[i] = 0;
    }

    let dftsize = 2;
    let t = 0;
    while (dftsize <= this.NFREQ) {
      const wpr = this.cossintable[0][t];
      const wpi = this.cossintable[1][t];
      let wr = 1.0;
      let wi = 0.0;
      const hdftsize = dftsize >> 1;

      for (let m = 0; m < hdftsize; m++) {
        for (let i = m; i < this.NFREQ; i += dftsize) {
          const j = i + hdftsize;
          const tempr = wr * real[j] - wi * imag[j];
          const tempi = wr * imag[j] + wi * real[j];

          real[j] = real[i] - tempr;
          imag[j] = imag[i] - tempi;
          real[i] += tempr;
          imag[i] += tempi;
        }

        const wtemp = wr;
        wr = wtemp * wpr - wi * wpi;
        wi = wi * wpr + wtemp * wpi;
      }

      dftsize <<= 1;
      t += 1;
    }

    const spectralDataOut = new Float32Array(this.samplesOut);
    for (let i = 0; i < this.samplesOut; i++) {
      const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
      spectralDataOut[i] = this.equalize ? (this.equalizeArr![i] * mag) : mag;
    }

    return spectralDataOut;
  }
  /* eslint-enable no-bitwise */
}
