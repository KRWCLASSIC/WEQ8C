import { createNanoEvents, Emitter, Unsubscribe } from "nanoevents";
import { WEQ8Spec, FilterType, DEFAULT_SPEC, FILTER_TYPES } from "./spec";
import { getBiquadFilterOrder, getBiquadFilterType, buildHardClipCurve, buildSoftClipCurve, buildFoldbackCurve } from "./functions";
import pkg from "../package.json";

export type SaturationMode = "none" | "hard" | "soft" | "foldback" | "limit";

interface WEQ8Events {
  filtersChanged: (spec: WEQ8Spec) => void;
  saturationChanged: (mode: SaturationMode) => void;
}
export class WEQ8Runtime {
  public static readonly version: string = pkg.version;
  public readonly input: GainNode;
  private readonly output: GainNode;

  private filterbank: { idx: number; filters: BiquadFilterNode[] }[] = [];
  private saturatorNode: AudioNode | null = null;
  private _saturationMode: SaturationMode = "none";
  private _saturationThreshold: number = 1.0;

  private readonly emitter: Emitter<WEQ8Events>;

  private debugAnalyser: AnalyserNode | null = null;

  constructor(
    public readonly audioCtx: BaseAudioContext,
    public readonly spec: WEQ8Spec = DEFAULT_SPEC,
    public readonly supportedFilterTypes: FilterType[] = FILTER_TYPES
  ) {
    this.input = audioCtx.createGain();
    this.output = audioCtx.createGain();
    
    // Create an internal analyser node connected to the output for live audio stats
    this.debugAnalyser = audioCtx.createAnalyser();
    this.debugAnalyser.fftSize = 1024;
    this.output.connect(this.debugAnalyser);

    this.buildFilterChain(spec);
    this.emitter = createNanoEvents();
  }

  connect(node: AudioNode): void {
    this.output.connect(node);
  }

  disconnect(node: AudioNode): void {
    this.output.disconnect(node);
  }

  on<E extends keyof WEQ8Events>(
    event: E,
    callback: WEQ8Events[E]
  ): Unsubscribe {
    return this.emitter.on(event, callback);
  }

  get saturationMode(): SaturationMode {
    return this._saturationMode;
  }

  get saturationThreshold(): number {
    return this._saturationThreshold;
  }

  get inputGain(): number {
    return this.input.gain.value;
  }

  set inputGain(val: number) {
    this.input.gain.value = val;
  }

  get outputGain(): number {
    return this.output.gain.value;
  }

  set outputGain(val: number) {
    this.output.gain.value = val;
  }

  setSaturationMode(mode: SaturationMode, options?: { threshold?: number }): void {
    const threshold = options?.threshold ?? 1.0;
    this._saturationMode = mode;
    this._saturationThreshold = threshold;

    this.rebuildSaturatorConnection();
    this.emitter.emit("saturationChanged", mode);
  }

  private rebuildSaturatorConnection(): void {
    // Determine what node should connect to the output.
    // If we have a filterbank, the last filter in the filterbank should connect to our saturator, which connects to output.
    // If not, input connects to our saturator, which connects to output.
    
    // First, disconnect the existing saturator node if it exists
    if (this.saturatorNode) {
      this.saturatorNode.disconnect();
      this.saturatorNode = null;
    }

    // Disconnect the source node from the output (it could be input or the last filter)
    const sourceNode = this.getLastActiveSourceNode();
    try {
      sourceNode.disconnect(this.output);
    } catch (e) {
      // It might not be connected directly to output; that's fine.
    }

    if (this._saturationMode === "none") {
      // Connect directly to output
      sourceNode.connect(this.output);
    } else if (this._saturationMode === "limit") {
      const limiter = this.audioCtx.createDynamicsCompressor();
      limiter.threshold.value = -0.1; // close to 0 dBFS/1.0
      limiter.knee.value = 0.0;
      limiter.ratio.value = 20.0;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.05;
      
      this.saturatorNode = limiter;
      sourceNode.connect(limiter);
      limiter.connect(this.output);
    } else {
      // WaveShaper modes: "hard", "soft", "foldback"
      const shaper = this.audioCtx.createWaveShaper();
      shaper.oversample = "4x";
      const length = 4096;
      if (this._saturationMode === "hard") {
        shaper.curve = buildHardClipCurve(length, this._saturationThreshold) as any;
      } else if (this._saturationMode === "soft") {
        shaper.curve = buildSoftClipCurve(length, this._saturationThreshold) as any;
      } else if (this._saturationMode === "foldback") {
        shaper.curve = buildFoldbackCurve(length, this._saturationThreshold) as any;
      }
      this.saturatorNode = shaper;
      sourceNode.connect(shaper);
      shaper.connect(this.output);
    }
  }

  private getLastActiveSourceNode(): AudioNode {
    if (this.filterbank.length === 0) {
      return this.input;
    }
    const lastBank = this.filterbank[this.filterbank.length - 1];
    return lastBank.filters[lastBank.filters.length - 1];
  }

  setFilterType(idx: number, type: FilterType | "noop"): void {
    if (
      type === "noop" &&
      this.spec[idx].type !== "noop" &&
      !this.spec[idx].bypass
    ) {
      this.disconnectFilter(idx);
    }
    if (type === "noop") {
      this.spec[idx].bypass = false;
    } else if (this.spec[idx].type === "noop") {
      this.spec[idx].bypass = false;
      this.connectFilter(idx, type);
    }
    this.spec[idx].type = type;
    if (type !== "noop" && !this.spec[idx].bypass) {
      let filters = this.filterbank.find((f) => f.idx === idx)?.filters;
      if (!filters) {
        throw new Error("Assertion failed: No filters in filterbank");
      }
      for (let filter of filters) {
        filter.type = getBiquadFilterType(type);
      }
      let order = getBiquadFilterOrder(type);
      while (filters.length > order) {
        let indexToRemove = filters.length - 1;
        let filterToRemove = filters[indexToRemove];
        let previous = filters[indexToRemove - 1];
        let next = this.getNextInChain(idx);
        filterToRemove.disconnect();
        previous.disconnect(filterToRemove);
        previous.connect(next);
        filters.splice(indexToRemove, 1);
      }
      while (filters.length < order) {
        let newFilter = this.audioCtx.createBiquadFilter();
        newFilter.type = getBiquadFilterType(type);
        newFilter.frequency.value = this.spec[idx].frequency;
        newFilter.Q.value = this.spec[idx].Q;
        newFilter.gain.value = this.spec[idx].gain;
        let previous = filters[filters.length - 1];
        let next = this.getNextInChain(idx);
        previous.disconnect(next);
        previous.connect(newFilter);
        newFilter.connect(next);
        filters.push(newFilter);
      }
    }
    this.emitter.emit("filtersChanged", this.spec);
  }

  toggleBypass(idx: number, bypass: boolean): void {
    if (bypass && !this.spec[idx].bypass && this.spec[idx].type !== "noop") {
      this.disconnectFilter(idx);
    } else if (
      !bypass &&
      this.spec[idx].bypass &&
      this.spec[idx].type !== "noop"
    ) {
      this.connectFilter(idx, this.spec[idx].type as FilterType);
    }
    this.spec[idx].bypass = bypass;
    this.emitter.emit("filtersChanged", this.spec);
  }

  private disconnectFilter(idx: number) {
    let filters = this.filterbank.find((f) => f.idx === idx)?.filters;
    if (!filters) {
      throw new Error(
        "Assertion failed: No filters in filterbank when disconnecting filter. Was it connected?"
      );
    }
    let previous = this.getPreviousInChain(idx);
    let next = this.getNextInChain(idx);
    previous.disconnect(filters[0]);
    filters[filters.length - 1].disconnect(next);
    previous.connect(next);
    this.filterbank = this.filterbank.filter((f) => f.idx !== idx);
    
    // Reconnect the last active node to the output / saturator
    this.rebuildSaturatorConnection();
  }

  private connectFilter(idx: number, type: FilterType) {
    let filters = Array.from({ length: getBiquadFilterOrder(type) }, () => {
      let newFilter = this.audioCtx.createBiquadFilter();
      newFilter.type = getBiquadFilterType(type);
      newFilter.frequency.value = this.spec[idx].frequency;
      newFilter.Q.value = this.spec[idx].Q;
      newFilter.gain.value = this.spec[idx].gain;
      return newFilter;
    });
    let previous = this.getPreviousInChain(idx);
    let next = this.getNextInChain(idx);
    previous.disconnect(next);
    previous.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1]);
    }
    filters[filters.length - 1].connect(next);
    this.filterbank.push({ idx, filters });
    this.filterbank.sort((a, b) => a.idx - b.idx);

    // Reconnect the last active node to the output / saturator
    this.rebuildSaturatorConnection();
  }

  setFilterFrequency(idx: number, frequency: number): void {
    this.spec[idx].frequency = frequency;
    let bankEntry = this.filterbank.find((f) => f.idx === idx);
    if (bankEntry) {
      for (let filter of bankEntry.filters) {
        filter.frequency.value = frequency;
      }
    }
    this.emitter.emit("filtersChanged", this.spec);
  }

  setFilterQ(idx: number, Q: number): void {
    this.spec[idx].Q = Q;
    let bankEntry = this.filterbank.find((f) => f.idx === idx);
    if (bankEntry) {
      for (let filter of bankEntry.filters) {
        filter.Q.value = Q;
      }
    }
    this.emitter.emit("filtersChanged", this.spec);
  }

  setFilterGain(idx: number, gain: number): void {
    this.spec[idx].gain = gain;
    let bankEntry = this.filterbank.find((f) => f.idx === idx);
    if (bankEntry) {
      for (let filter of bankEntry.filters) {
        filter.gain.value = gain;
      }
    }
    this.emitter.emit("filtersChanged", this.spec);
  }

  getEqResponseAtFrequency(hz: number): {
    magnitudeDb: number;
    phaseDeg: number;
  } {
    const frequencies = new Float32Array([hz]);
    const magResponse = new Float32Array(1);
    const phaseResponse = new Float32Array(1);
    let totalMag = 1;
    let totalPhase = 0;

    for (let i = 0; i < this.spec.length; i++) {
      if (this.spec[i].type === "noop" || this.spec[i].bypass) continue;
      const order = getBiquadFilterOrder(this.spec[i].type);
      for (let j = 0; j < order; j++) {
        if (
          this.getFrequencyResponse(
            i,
            j,
            frequencies,
            magResponse,
            phaseResponse
          )
        ) {
          totalMag *= magResponse[0];
          totalPhase += phaseResponse[0];
        }
      }
    }

    return {
      magnitudeDb: totalMag > 0 ? 20 * Math.log10(totalMag) : -96,
      phaseDeg: (totalPhase * 180) / Math.PI,
    };
  }

  getFrequencyResponse(
    idx: number,
    filterIdx: number,
    frequencies: Float32Array,
    magResponse: Float32Array,
    phaseResponse: Float32Array
  ): boolean {
    let filter = this.filterbank.find((f) => f.idx === idx);
    if (filter) {
      filter.filters[filterIdx].getFrequencyResponse(
        frequencies as any,
        magResponse as any,
        phaseResponse as any
      );
      return true;
    } else {
      return false;
    }
  }

  getDebugStats(): {
    curveMaxDb: number;
    curveMaxDbFreq: number;
    curveMinDb: number;
    curveMinDbFreq: number;
    curveMaxPhase: number;
    activeBandsCount: number;
    totalBiquadNodes: number;
    audioMaxDb: number;
    audioMaxDbFreq: number;
    isClipping: boolean;
    version: string;
    inputGain: number;
    outputGain: number;
  } {
    // 1. STATIC CURVE METRICS
    const size = 512;
    const frequencies = new Float32Array(size);
    const nyquist = this.audioCtx.sampleRate / 2;
    const minLog = Math.log10(20);
    const maxLog = Math.log10(nyquist);

    for (let i = 0; i < size; i++) {
      const log = minLog + (i / (size - 1)) * (maxLog - minLog);
      frequencies[i] = Math.pow(10, log);
    }

    const totalResponse = new Float32Array(size);
    const totalPhase = new Float32Array(size);
    totalResponse.fill(1.0);
    totalPhase.fill(0.0);

    const magResponse = new Float32Array(size);
    const phaseResponse = new Float32Array(size);

    let activeBandsCount = 0;
    let totalBiquadNodes = 0;

    for (let i = 0; i < this.spec.length; i++) {
      if (this.spec[i].type === "noop" || this.spec[i].bypass) continue;
      activeBandsCount++;
      const order = getBiquadFilterOrder(this.spec[i].type);
      totalBiquadNodes += order;
      for (let j = 0; j < order; j++) {
        const updated = this.getFrequencyResponse(i, j, frequencies, magResponse, phaseResponse);
        if (updated) {
          for (let k = 0; k < size; k++) {
            totalResponse[k] *= magResponse[k];
            totalPhase[k] += phaseResponse[k];
          }
        }
      }
    }

    let maxGain = 0;
    let minGain = Infinity;
    let curveMaxDbFreq = 0;
    let curveMinDbFreq = 0;
    let maxPhaseRad = 0;

    for (let i = 0; i < size; i++) {
      const gain = totalResponse[i];
      if (gain > maxGain) {
        maxGain = gain;
        curveMaxDbFreq = frequencies[i];
      }
      if (gain < minGain) {
        minGain = gain;
        curveMinDbFreq = frequencies[i];
      }
      const absPhase = Math.abs(totalPhase[i]);
      if (absPhase > maxPhaseRad) {
        maxPhaseRad = absPhase;
      }
    }

    const curveMaxDb = maxGain > 0 ? 20 * Math.log10(maxGain) : -96;
    const curveMinDb = minGain > 0 ? 20 * Math.log10(minGain) : -96;
    const curveMaxPhase = (maxPhaseRad * 180) / Math.PI; // rad to deg

    // 2. LIVE AUDIO METRICS
    let audioMaxDb = -96;
    let audioMaxDbFreq = 0;
    let isClipping = false;

    if (this.debugAnalyser) {
      // Get Time Domain Data to find peak amplitude
      const timeData = new Float32Array(this.debugAnalyser.fftSize);
      this.debugAnalyser.getFloatTimeDomainData(timeData);
      
      let peakAmp = 0;
      for (let i = 0; i < timeData.length; i++) {
        const absVal = Math.abs(timeData[i]);
        if (absVal > peakAmp) {
          peakAmp = absVal;
        }
      }

      if (peakAmp > 0) {
        audioMaxDb = 20 * Math.log10(peakAmp);
      }
      
      // Determine if clipping/saturating
      const clipThreshold = this._saturationMode === "none" ? 1.0 : this._saturationThreshold;
      isClipping = peakAmp >= clipThreshold;

      // Get Frequency Domain Data to find the highest energy frequency bin
      const freqData = new Float32Array(this.debugAnalyser.frequencyBinCount);
      this.debugAnalyser.getFloatFrequencyData(freqData);

      let maxBinVal = -Infinity;
      let maxBinIdx = 0;
      for (let i = 0; i < freqData.length; i++) {
        if (freqData[i] > maxBinVal) {
          maxBinVal = freqData[i];
          maxBinIdx = i;
        }
      }
      audioMaxDbFreq = (maxBinIdx * this.audioCtx.sampleRate) / this.debugAnalyser.fftSize;
    }

    return {
      curveMaxDb,
      curveMaxDbFreq,
      curveMinDb,
      curveMinDbFreq,
      curveMaxPhase,
      activeBandsCount,
      totalBiquadNodes,
      audioMaxDb,
      audioMaxDbFreq,
      isClipping,
      version: WEQ8Runtime.version,
      inputGain: this.inputGain,
      outputGain: this.outputGain
    };
  }

  private buildFilterChain(specs: WEQ8Spec): void {
    this.filterbank = [];
    for (let i = 0; i < specs.length; i++) {
      let spec = specs[i];
      if (spec.type === "noop" || spec.bypass) continue;
      let filters = Array.from(
        { length: getBiquadFilterOrder(spec.type) },
        () => {
          let filter = this.audioCtx.createBiquadFilter();
          filter.type = getBiquadFilterType(spec.type as FilterType);
          filter.frequency.value = spec.frequency;
          filter.Q.value = spec.Q;
          filter.gain.value = spec.gain;
          return filter;
        }
      );
      this.filterbank.push({ idx: i, filters });
    }
    
    // Connect biquad filter chain together
    if (this.filterbank.length > 0) {
      for (let i = 0; i < this.filterbank.length; i++) {
        let { filters } = this.filterbank[i];
        if (i === 0) {
          this.input.connect(filters[0]);
        } else {
          this.filterbank[i - 1].filters[
            this.filterbank[i - 1].filters.length - 1
          ].connect(filters[0]);
        }
        for (let j = 0; j < filters.length - 1; j++) {
          filters[j].connect(filters[j + 1]);
        }
      }
    }

    // Set up the output connection through our saturator
    this.rebuildSaturatorConnection();
  }

  private getPreviousInChain(idx: number): AudioNode {
    let prev = this.input,
      prevIndex = -1;
    for (let filter of this.filterbank) {
      if (filter.idx < idx && filter.idx > prevIndex) {
        prev = filter.filters[filter.filters.length - 1];
        prevIndex = filter.idx;
      }
    }
    return prev;
  }

  private getNextInChain(idx: number): AudioNode {
    // If this is the last filter in the filterbank, it connects to the saturator node (if active) or output
    let next: AudioNode = this.saturatorNode || this.output,
      nextIndex: number = this.spec.length;
    for (let filter of this.filterbank) {
      if (filter.idx > idx && filter.idx < nextIndex) {
        next = filter.filters[0];
        nextIndex = filter.idx;
      }
    }
    return next;
  }
}
