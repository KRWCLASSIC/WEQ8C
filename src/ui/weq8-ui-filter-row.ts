import { LitElement, html, css, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { WEQ8Runtime } from "../runtime";
import { FilterType } from "../spec";
import {
  clamp,
  filterHasFrequency,
  filterHasGain,
  filterHasQ,
  formatFrequency,
  formatFrequencyUnit,
  toLin,
  toLog10,
} from "../functions";
import { sharedStyles } from "./styles";
import { TYPE_OPTIONS } from "./constants";

type DragState = {
  pointer: number;
  startY: number;
  startValue: number;
};

@customElement("weq8-ui-filter-row")
export class EQUIFilterRowElement extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: grid;
        grid-auto-flow: column;
        grid-template-columns: 60px 60px 50px 40px;
        align-items: center;
        gap: 4px;
        background-color: transparent;
        border-radius: 22px;
        transition: background-color 0.15s ease;
      }
      :host(.selected) {
        background-color: #373737;
      }
      input,
      select {
        padding: 0;
        border: 0;
      }
      input {
        border-bottom: 1px solid transparent;
        transition: border-color 0.15s ease;
      }
      input:focus,
      input:active {
        border-color: white;
      }
      .chip {
        display: inline-grid;
        grid-auto-flow: column;
        gap: 3px;
        height: 20px;
        padding-right: 6px;
        border-radius: 10px;
        background: #373737;
        transition: background-color 0.15s ease;
      }
      :host(.selected) .chip .filterNumber {
        background: #ffcc00;
      }
      .chip.disabled:hover {
        background: #444444;
      }
      :host(.drag-over) {
        outline: 2px solid #00ffcc;
        outline-offset: -2px;
        border-radius: 22px;
      }
      .filterNumber {
        cursor: pointer;
        width: 20px;
        height: 20px;
        border-radius: 10px;
        display: grid;
        place-content: center;
        background: white;
        font-weight: var(--font-weight);
        color: black;
        transition: background-color 0.15s ease;
      }
      .filterNumber[draggable="true"] {
        cursor: grab;
      }
      .filterNumber[draggable="true"]:active {
        cursor: grabbing;
      }
      .chip.disabled .filterNumber {
        background: transparent;
        color: white;
      }
      .chip.bypassed .filterNumber {
        background: #7d7d7d;
        color: black;
      }
      .filterTypeSelect {
        width: 30px;
        appearance: none;
        outline: none;
        background-color: transparent;
        color: white;
        cursor: pointer;
        text-align: center;
        font-family: var(--font-stack);
        font-size: var(--font-size);
        font-weight: var(--font-weight);
      }
      .filterTypeSelect option {
        background-color: #202020;
        color: white;
      }
      .filterTypeSelect.bypassed {
        color: #7d7d7d;
      }
      .chip.disabled .filterTypeSelect {
        pointer-events: all;
      }
      .frequencyInput {
        width: 28px;
      }
      .gainInput {
        width: 26px;
      }
      .qInput {
        width: 30px;
      }
      .numberInput {
        appearance: none;
        outline: none;
        background-color: transparent;
        color: white;
        text-align: right;
        -moz-appearance: textfield;
        font-family: var(--font-stack);
        font-size: var(--font-size);
        font-weight: var(--font-weight);
        touch-action: none;
      }
      .numberInput:disabled,
      .disabled {
        color: #7d7d7d;
        pointer-events: none;
      }
      .bypassed {
        color: #7d7d7d;
      }
      .numberInput::-webkit-inner-spin-button,
      .numberInput::-webkit-outer-spin-button {
        -webkit-appearance: none !important;
        margin: 0 !important;
      }
    `,
  ];

  static addCustomStyles(cssString: string) {
    const newStyle = unsafeCSS(cssString);
    if (Array.isArray(this.styles)) {
      this.styles = [...this.styles, newStyle];
    } else if (this.styles) {
      this.styles = [this.styles as any, newStyle];
    } else {
      this.styles = [newStyle];
    }
    // Force Lit to re-evaluate elementStyles for all new instances
    if ((this as any).finalizeStyles) {
      this.elementStyles = (this as any).finalizeStyles(this.styles);
    }
  }

  constructor() {
    super();
    this.addEventListener("click", () =>
      this.dispatchEvent(
        new CustomEvent("select", { composed: true, bubbles: true })
      )
    );
  }

  @property({ attribute: false })
  runtime?: WEQ8Runtime;

  @property()
  index?: number;

  @state()
  private frequencyInputFocused = false;

  @state()
  private dragStates: {
    frequency: DragState | null;
    gain: DragState | null;
    Q: DragState | null;
  } = { frequency: null, gain: null, Q: null };

  render() {
    if (!this.runtime || this.index === undefined) return;

    let spec = this.runtime.spec[this.index];
    const isNoop = spec.type === "noop";

    let typeOptions = TYPE_OPTIONS.filter((o) => {
      if (o[0] === "noop") return isNoop;
      return this.runtime!.supportedFilterTypes.includes(o[0] as FilterType);
    });

    // Compute dynamic filter recommendations based on active bands
    const activeIndices = this.runtime.spec
      .map((s, idx) => s.type !== "noop" ? idx : -1)
      .filter(idx => idx !== -1);

    let firstActiveIdx = 0;
    let lastActiveIdx = 7;

    if (activeIndices.length > 0) {
      firstActiveIdx = activeIndices[0];
      lastActiveIdx = activeIndices[activeIndices.length - 1];
    }

    let recType: FilterType | "noop" = "peaking12";
    if (this.index === 0 || this.index === firstActiveIdx) {
      // First filter and first active band always suggest LS12
      recType = "lowshelf12";
    } else if (this.index >= lastActiveIdx) {
      // Last active band and any band after it suggest HS12
      recType = "highshelf12";
    }

    return html`
      <th>
        <div
          class=${classMap({
            chip: true,
            disabled: isNoop,
            bypassed: spec.bypass,
          })}
        >
          <div
            class=${classMap({
              filterNumber: true,
              bypassed: spec.bypass,
              disabled: isNoop,
            })}
            draggable=${isNoop ? 'false' : 'true'}
            @click=${() => {
              if (isNoop) {
                this.setFilterType(recType);
              } else {
                this.toggleBypass();
              }
            }}
            @contextmenu=${(evt: MouseEvent) => {
              if (!isNoop) {
                evt.preventDefault();
                this.setFilterType("noop");
              }
            }}
            @dragstart=${(evt: DragEvent) => {
              if (isNoop) { evt.preventDefault(); return; }
              evt.dataTransfer!.effectAllowed = 'move';
              this.dispatchEvent(new CustomEvent('band-drag-start', {
                detail: { index: this.index },
                bubbles: true, composed: true,
              }));
            }}
            @dragover=${(evt: DragEvent) => {
              evt.preventDefault();
              evt.dataTransfer!.dropEffect = 'move';
              this.dispatchEvent(new CustomEvent('band-drag-over', {
                detail: { index: this.index },
                bubbles: true, composed: true,
              }));
            }}
            @dragleave=${() => {
              this.dispatchEvent(new CustomEvent('band-drag-leave', {
                detail: { index: this.index },
                bubbles: true, composed: true,
              }));
            }}
            @drop=${(evt: DragEvent) => {
              evt.preventDefault();
              this.dispatchEvent(new CustomEvent('band-drop', {
                detail: { index: this.index },
                bubbles: true, composed: true,
              }));
            }}
            title=${isNoop ? "Click to Add Band" : "Click to Toggle Bypass / Right-click to Remove | Drag to reorder"}
          >
            ${this.index + 1}
          </div>
          <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 30px; height: 20px;">
            <span style="color: ${spec.bypass ? '#7d7d7d' : 'white'}; font-family: var(--font-stack); font-size: var(--font-size); font-weight: var(--font-weight); pointer-events: none; text-align: center; white-space: nowrap;">
              ${TYPE_OPTIONS.find(o => o[0] === spec.type)?.[1] ?? spec.type}
            </span>
            <select
              class=${classMap({ filterTypeSelect: true, bypassed: spec.bypass })}
              style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; margin: 0; padding: 0;"
              @change=${(evt: { target: HTMLSelectElement }) =>
                this.setFilterType(evt.target.value as FilterType | "noop")}
            >
              ${typeOptions.map(([type, label]) => {
                const displayLabel = type === recType ? `${label} ★` : label;
                return html`<option value=${type} ?selected=${spec.type === type}>
                  ${displayLabel}
                </option>`;
              })}
            </select>
          </div>
        </div>
      </th>
      <td>
        <input
          class=${classMap({
            frequencyInput: true,
            numberInput: true,
            bypassed: spec.bypass,
          })}
          type="number"
          step="0.1"
          lang="en_EN"
          .value=${formatFrequency(spec.frequency, this.frequencyInputFocused)}
          ?disabled=${!filterHasFrequency(spec.type)}
          @focus=${() => (this.frequencyInputFocused = true)}
          @blur=${() => {
            this.frequencyInputFocused = false;
            this.setFilterFrequency(clamp(spec.frequency, 10, this.nyquist));
          }}
          @input=${(evt: { target: HTMLInputElement }) =>
            this.setFilterFrequency(evt.target.valueAsNumber)}
          @pointerdown=${(evt: PointerEvent) =>
            this.startDraggingValue(evt, "frequency")}
          @pointerup=${(evt: PointerEvent) =>
            this.stopDraggingValue(evt, "frequency")}
          @pointermove=${(evt: PointerEvent) =>
            this.dragValue(evt, "frequency")}
        />
        <span
          class=${classMap({
            frequencyUnit: true,
            disabled: !filterHasFrequency(spec.type),
            bypassed: spec.bypass,
          })}
          >${formatFrequencyUnit(
            spec.frequency,
            this.frequencyInputFocused
          )}</span
        >
      </td>
      <td>
        ${filterHasGain(spec.type) ? html`
          <input
            class=${classMap({
              gainInput: true,
              numberInput: true,
              bypassed: spec.bypass,
            })}
            type="number"
            min="-15"
            max="15"
            step="0.1"
            lang="en_EN"
            .value=${spec.gain.toFixed(1)}
            @input=${(evt: { target: HTMLInputElement }) =>
              this.setFilterGain(evt.target.valueAsNumber)}
            @pointerdown=${(evt: PointerEvent) =>
              this.startDraggingValue(evt, "gain")}
            @pointerup=${(evt: PointerEvent) =>
              this.stopDraggingValue(evt, "gain")}
            @pointermove=${(evt: PointerEvent) => this.dragValue(evt, "gain")}
          />
          <span
            class=${classMap({
              gainUnit: true,
              bypassed: spec.bypass,
            })}
            >dB</span
          >
        ` : html`
          <span class="disabled bypassed" style="font-family: var(--font-stack); font-size: var(--font-size); font-weight: var(--font-weight); display: block; text-align: right; width: 26px; line-height: 20px; color: #7d7d7d; cursor: not-allowed; user-select: none;">--</span>
        `}
      </td>
      <td>
        ${filterHasQ(spec.type) ? html`
          <input
            class=${classMap({
              qInput: true,
              numberInput: true,
              bypassed: spec.bypass,
            })}
            type="number"
            min="0.1"
            max="18"
            step="0.1"
            .value=${spec.Q.toFixed(2)}
            @input=${(evt: { target: HTMLInputElement }) =>
              this.setFilterQ(evt.target.valueAsNumber)}
            @pointerdown=${(evt: PointerEvent) =>
              this.startDraggingValue(evt, "Q")}
            @pointerup=${(evt: PointerEvent) => this.stopDraggingValue(evt, "Q")}
            @pointermove=${(evt: PointerEvent) => this.dragValue(evt, "Q")}
          />
        ` : html`
          <span class="disabled bypassed" style="font-family: var(--font-stack); font-size: var(--font-size); font-weight: var(--font-weight); display: block; text-align: right; width: 30px; line-height: 20px; color: #7d7d7d; cursor: not-allowed; user-select: none;">--</span>
        `}
      </td>
    `;
  }

  private get nyquist() {
    return (this.runtime?.audioCtx.sampleRate ?? 48000) / 2;
  }

  private toggleBypass() {
    if (!this.runtime || this.index === undefined) return;
    this.runtime.toggleBypass(
      this.index,
      !this.runtime.spec[this.index].bypass
    );
  }

  private setFilterType(type: FilterType | "noop") {
    if (!this.runtime || this.index === undefined) return;
    this.runtime.setFilterType(this.index, type);
  }

  private setFilterFrequency(frequency: number) {
    if (!this.runtime || this.index === undefined) return;
    if (!isNaN(frequency)) {
      this.runtime.setFilterFrequency(this.index, frequency);
    }
  }

  private setFilterGain(gain: number) {
    if (!this.runtime || this.index === undefined) return;
    if (!isNaN(gain)) {
      this.runtime.setFilterGain(this.index, gain);
    }
  }

  private setFilterQ(Q: number) {
    if (!this.runtime || this.index === undefined) return;
    if (!isNaN(Q)) {
      this.runtime.setFilterQ(this.index, Q);
    }
  }

  private startDraggingValue(
    evt: PointerEvent,
    property: "frequency" | "gain" | "Q"
  ) {
    if (!this.runtime || this.index === undefined) return;

    (evt.target as Element).setPointerCapture(evt.pointerId);
    this.dragStates = {
      ...this.dragStates,
      [property]: {
        pointer: evt.pointerId,
        startY: evt.clientY,
        startValue: this.runtime.spec[this.index][property],
      },
    };
  }

  private stopDraggingValue(
    evt: PointerEvent,
    property: "frequency" | "gain" | "Q"
  ) {
    if (!this.runtime || this.index === undefined) return;

    if (this.dragStates[property]?.pointer === evt.pointerId) {
      (evt.target as Element).releasePointerCapture(evt.pointerId);
      this.dragStates = { ...this.dragStates, [property]: null };
    }
  }

  private dragValue(evt: PointerEvent, property: "frequency" | "gain" | "Q") {
    if (!this.runtime || this.index === undefined) return;
    let dragState = this.dragStates[property];
    if (dragState && dragState.pointer === evt.pointerId) {
      let startY = dragState.startY;
      let currentY = evt.clientY;
      let yDelta = -(currentY - startY);
      let relYDelta = clamp(yDelta / 150, -1, 1);
      if (property === "frequency") {
        let minFreq = 10;
        let maxFreq = this.runtime.audioCtx.sampleRate / 2;
        let startFreqLog = toLog10(dragState.startValue, minFreq, maxFreq);
        let newFreq = toLin(startFreqLog + relYDelta, minFreq, maxFreq);
        this.runtime.setFilterFrequency(this.index, newFreq);
      } else if (property === "gain") {
        let gainDelta = relYDelta * 15;
        this.runtime.setFilterGain(
          this.index,
          clamp(dragState.startValue + gainDelta, -15, 15)
        );
      } else if (property === "Q") {
        let minQ = 0.1;
        let maxQ = 18;
        let startQLog = toLog10(dragState.startValue, minQ, maxQ);
        let newQ = toLin(startQLog + relYDelta, minQ, maxQ);
        this.runtime.setFilterQ(this.index, newQ);
      }
      (evt.target as HTMLInputElement).blur();
    }
  }
}
