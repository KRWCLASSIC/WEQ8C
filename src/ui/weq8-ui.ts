import { LitElement, html, css, svg, ReactiveElement, unsafeCSS } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { WEQ8Runtime } from "../runtime";
import { WEQ8Filter } from "../spec";
import { WEQ8Analyser } from "./WEQ8Analyser";
import { WEQ8FrequencyResponse } from "./WEQ8FrequencyResponse";
import { sharedStyles } from "./styles";
import {
  clamp,
  filterHasGain,
  filterHasQ,
  formatFrequency,
  formatFrequencyUnit,
  getActiveBandDisplayNumber,
  toLin,
  toLog10,
} from "../functions";

/** Matches WEQ8FrequencyResponse canvas vertical scale. */
const CURVE_MIN_DB = -13;
const CURVE_MAX_DB = 13;

type CurveProbe = {
  xPercent: number;
  curveYPercent: number;
  fromTop: boolean;
  frequency: number;
  magnitudeDb: number;
  phaseDeg: number;
};

import "./weq8-ui-filter-row";
import "./weq8-ui-filter-hud";

@customElement("weq8-ui")
export class WEQ8UIElement extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        position: relative;
        display: flex;
        flex-direction: row;
        align-items: stretch;
        gap: 10px;
        min-width: 600px;
        min-height: 200px;
        padding: 20px;
        border-radius: 8px;
        overflow: visible;
        background: #202020;
        border: 1px solid #373737;
      }
      .filters {
        display: inline-grid;
        grid-auto-flow: row;
        gap: 4px;
      }
      .filters tbody,
      .filters tr {
        display: contents;
      }
      .filters thead {
        display: grid;
        grid-auto-flow: column;
        grid-template-columns: 60px 60px 50px 40px;
        align-items: center;
        gap: 4px;
      }
      .filters thead th {
        display: grid;
        place-content: center;
        height: 20px;
        border-radius: 10px;
        font-weight: var(--font-weight);
        border: 1px solid #373737;
      }
      .filters thead th.headerFilter {
        text-align: left;
        padding-left: 18px;
        border: none;
      }
      .visualisation {
        flex: 1;
        position: relative;
        border: 1px solid #373737;
      }
      .curve-probe-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
      }
      canvas,
      svg {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
      }
      svg {
        overflow: visible;
      }
      .grid-x,
      .grid-y {
        stroke: #333;
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }
      .filter-handle-positioner {
        position: absolute;
        top: 0;
        left: 0;
        width: 30px;
        height: 30px;
        touch-action: none;
      }
      .filter-handle {
        position: absolute;
        top: 0;
        left: 0;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background-color: #fff;
        color: black;
        transform: translate(-50%, -50%);
        display: flex;
        justify-content: center;
        align-items: center;
        user-select: none;
        cursor: grab;
        transition: background-color 0.15s ease;
      }
      .filter-handle.selected {
        background: #ffcc00;
      }
      .filter-handle.bypassed {
        background: #7d7d7d;
      }
      .curve-probe-overlay {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 2;
      }
      .curve-probe-line {
        stroke: #7d7d7d;
        stroke-width: 1;
        stroke-dasharray: 3 3;
        vector-effect: non-scaling-stroke;
      }
      .curve-probe-marker {
        position: absolute;
        width: 8px;
        height: 8px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: #ffcc00;
        border: 1px solid #202020;
        pointer-events: none;
        z-index: 4;
      }
      .curve-probe-anchor {
        position: absolute;
        width: 0;
        height: 0;
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 2;
      }
      .curve-probe-stats {
        position: absolute;
        z-index: 2;
        pointer-events: none;
        display: grid;
        gap: 2px;
        padding: 5px 8px;
        border-radius: 10px;
        background: #373737;
        font-family: var(--font-stack);
        font-size: var(--font-size);
        font-weight: var(--font-weight);
        line-height: 1.3;
        white-space: nowrap;
        box-sizing: border-box;
      }
      .curve-probe-stats.placement-below {
        left: 50%;
        top: 16px;
        transform: translateX(-50%);
      }
      .curve-probe-stats.placement-above {
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
      }
      .curve-probe-stats.placement-right {
        left: 16px;
        top: 50%;
        transform: translateY(-50%);
      }
      .curve-probe-stats.placement-left {
        right: 16px;
        top: 50%;
        transform: translateY(-50%);
      }
      .curve-probe-stats .probe-row {
        display: grid;
        grid-template-columns: 34px 1fr;
        gap: 6px;
        align-items: baseline;
      }
      .curve-probe-stats .probe-label {
        color: #7d7d7d;
        font-size: 9px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .curve-probe-stats .probe-value {
        color: white;
        text-align: right;
      }
      .curve-probe-stats .probe-db {
        color: #ffcc00;
        font-weight: var(--font-weight);
      }
      .eq-context-menu {
        position: absolute;
        z-index: 10;
        min-width: 148px;
        padding: 4px 0;
        border-radius: 10px;
        background: #373737;
        border: 1px solid #373737;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.45);
        pointer-events: auto;
      }
      .eq-context-menu-item {
        padding: 7px 12px;
        font-family: var(--font-stack);
        font-size: var(--font-size);
        font-weight: var(--font-weight);
        color: #7d7d7d;
        cursor: default;
        user-select: none;
      }
      .eq-context-menu-item strong {
        color: white;
        font-weight: var(--font-weight);
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
    this.addEventListener("click", (evt) => {
      if (evt.composedPath()[0] === this) this.selectedFilterIdx = -1;
    });
    this.addEventListener("contextmenu", this.onHostContextMenu);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
  }

  disconnectedCallback() {
    document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
    super.disconnectedCallback();
  }

  private onDocumentPointerDown = (evt: PointerEvent) => {
    if (!this.curveContextMenu) return;
    const menu = this.renderRoot.querySelector(".eq-context-menu");
    if (menu && evt.composedPath().includes(menu)) return;
    this.curveContextMenu = null;
  };

  @property({ attribute: false })
  runtime?: WEQ8Runtime;

  @property()
  view: "hud" | "allBands" = "allBands";

  @state()
  private analyser?: WEQ8Analyser;

  @state()
  private frequencyResponse?: WEQ8FrequencyResponse;

  @state()
  private gridXs: number[] = [];

  @state()
  private dragStates: { [filterIdx: number]: number | null } = {};

  @state()
  private selectedFilterIdx = -1;

  @state()
  private dragSourceIdx = -1;

  @state()
  private dragOverIdx = -1;

  @state()
  private curveProbe: CurveProbe | null = null;

  private curveProbePointerId: number | null = null;

  @state()
  private curveContextMenu: { x: number; y: number } | null = null;

  @query(".analyser")
  private analyserCanvas?: HTMLCanvasElement;

  @query(".frequencyResponse")
  private frequencyResponseCanvas?: HTMLCanvasElement;

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("runtime")) {
      this.analyser?.dispose();
      this.frequencyResponse?.dispose();
      if (this.runtime && this.analyserCanvas && this.frequencyResponseCanvas) {
        this.analyser = new WEQ8Analyser(this.runtime, this.analyserCanvas);
        this.analyser.analyse();
        this.frequencyResponse = new WEQ8FrequencyResponse(
          this.runtime,
          this.frequencyResponseCanvas
        );
        this.frequencyResponse.render();

        let newGridXs: number[] = [];
        let nyquist = this.runtime.audioCtx.sampleRate / 2;
        let xLevelsOfScale = Math.floor(Math.log10(nyquist));
        for (let los = 0; los < xLevelsOfScale; los++) {
          let step = Math.pow(10, los + 1);
          for (let i = 1; i < 10; i++) {
            let freq = step * i;
            if (freq > nyquist) break;
            newGridXs.push(
              ((Math.log10(freq) - 1) / (Math.log10(nyquist) - 1)) * 100
            );
          }
        }
        this.gridXs = newGridXs;

        this.runtime.on("filtersChanged", () => {
          this.frequencyResponse?.render();
          if (this.curveProbe) {
            this.refreshCurveProbeAtFrequency(this.curveProbe.frequency);
          }
          this.requestUpdate();
          for (let row of Array.from(
            this.shadowRoot?.querySelectorAll("weq8-ui-filter-row") ?? []
          )) {
            (row as ReactiveElement).requestUpdate();
          }
        });
      }
    }
    if (changedProperties.has("view")) {
      this.requestUpdate(); // Request another update to set handle positions in new view flow
    }
  }

  render() {
    return html`
      ${this.view === "allBands" ? this.renderTable() : null}
      <div
        class="visualisation"
        @wheel=${(evt: WheelEvent) => evt.preventDefault()}
        @contextmenu=${this.onVisualisationContextMenu}
        @pointerdown=${this.onVisualisationPointerDown}
        @pointermove=${this.onVisualisationPointerMove}
        @pointerup=${this.onVisualisationPointerUp}
        @pointercancel=${this.onVisualisationPointerUp}
      >
        <svg
          viewBox="0 0 100 10"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          ${this.gridXs.map(this.renderGridX)}
          ${[12, 6, 0, -6, -12].map(this.renderGridY)}
        </svg>
        <canvas class="analyser"></canvas>
        <canvas
          class="frequencyResponse"
          @click=${() => (this.selectedFilterIdx = -1)}
        ></canvas>
        <div class="curve-probe-layer">
          ${this.curveProbe ? this.renderCurveProbe() : null}
        </div>
        ${this.runtime?.spec.map((s, i) =>
          s.type === "noop" ? undefined : this.renderFilterHandle(s, i)
        )}
        ${this.view === "hud" && this.selectedFilterIdx !== -1
          ? this.renderFilterHUD()
          : null}
      </div>
      ${this.curveContextMenu ? this.renderEqContextMenu() : null}
    `;
  }

  private renderTable() {
    return html` <table class="filters"
      @band-drag-start=${(e: CustomEvent) => { this.dragSourceIdx = e.detail.index; }}
      @band-drag-over=${(e: CustomEvent) => { this.dragOverIdx = e.detail.index; }}
      @band-drag-leave=${(e: CustomEvent) => { if (this.dragOverIdx === e.detail.index) this.dragOverIdx = -1; }}
      @band-drop=${(e: CustomEvent) => {
        const target = e.detail.index;
        if (this.dragSourceIdx !== -1 && target !== this.dragSourceIdx) {
          this.swapBands(this.dragSourceIdx, target);
        }
        this.dragSourceIdx = -1;
        this.dragOverIdx = -1;
      }}
      @dragend=${() => { this.dragSourceIdx = -1; this.dragOverIdx = -1; }}
    >
      <thead>
        <tr>
          <th class="headerFilter">Filter</th>
          <th>Freq</th>
          <th>Gain</th>
          <th>Q</th>
        </tr>
      </thead>
      <tbody>
        ${Array.from({ length: 8 }).map(
          (_, i) =>
            html`<weq8-ui-filter-row
              class="${classMap({ selected: this.selectedFilterIdx === i, 'drag-over': this.dragOverIdx === i && this.dragSourceIdx !== i })}"
              .runtime=${this.runtime}
              .index=${i}
              @select=${(evt: CustomEvent) => {
                this.selectedFilterIdx =
                  this.runtime?.spec[i].type === "noop" ? -1 : i;
                evt.stopPropagation();
              }}
            />`
        )}
      </tbody>
    </table>`;
  }

  private renderFilterHUD() {
    if (!this.runtime) return html``;
    let spec = this.runtime?.spec[this.selectedFilterIdx];
    let [x, y] = this.getFilterPositionInVisualisation(spec);
    return html`<weq8-ui-filter-hud
      .runtime=${this.runtime}
      .index=${this.selectedFilterIdx}
      .x=${x}
      .y=${y}
    />`;
  }

  private swapBands(a: number, b: number) {
    if (!this.runtime) return;
    const sa = { ...this.runtime.spec[a] };
    const sb = { ...this.runtime.spec[b] };
    // Write spec A's values into slot B and vice-versa
    for (const [src, dst] of [[sa, b], [sb, a]] as const) {
      this.runtime.setFilterType(dst, src.type);
      this.runtime.setFilterFrequency(dst, src.frequency);
      this.runtime.setFilterGain(dst, src.gain);
      this.runtime.setFilterQ(dst, src.Q);
      if (src.bypass !== this.runtime.spec[dst].bypass) {
        this.runtime.toggleBypass(dst, src.bypass);
      }
    }
  }

  private renderEqContextMenu() {
    const m = this.curveContextMenu!;
    return html`
      <div
        class="eq-context-menu"
        style="left: ${m.x}px; top: ${m.y}px;"
        @contextmenu=${(evt: MouseEvent) => evt.preventDefault()}
      >
        <div class="eq-context-menu-item">
          <strong>WEQ8C</strong> v${WEQ8Runtime.version}
        </div>
      </div>
    `;
  }

  private isInsideVisualisation(path: EventTarget[]) {
    const viz = this.renderRoot.querySelector(".visualisation");
    return viz ? path.includes(viz) : false;
  }

  private isActiveBandNumberContextMenu(path: EventTarget[]) {
    for (const el of path) {
      if (
        el instanceof HTMLElement &&
        el.classList.contains("filterNumber") &&
        el.getAttribute("draggable") === "true"
      ) {
        return true;
      }
    }
    return false;
  }

  private onHostContextMenu = (evt: MouseEvent) => {
    const path = evt.composedPath();

    if (this.isInsideVisualisation(path)) {
      return;
    }

    if (this.isActiveBandNumberContextMenu(path)) {
      return;
    }

    evt.preventDefault();
    evt.stopPropagation();

    const rect = this.getBoundingClientRect();
    const menuW = 148;
    const menuH = 32;
    this.curveContextMenu = {
      x: clamp(evt.clientX - rect.left, 4, Math.max(4, rect.width - menuW - 4)),
      y: clamp(evt.clientY - rect.top, 4, Math.max(4, rect.height - menuH - 4)),
    };
  };

  /** Anchor stats to the dot with equal gap (markerR + gap) on every side. */
  private getProbeLayout(p: CurveProbe) {
    const w = this.frequencyResponseCanvas?.offsetWidth ?? 0;
    const h = this.frequencyResponseCanvas?.offsetHeight ?? 0;
    const edge = 8;
    const gap = 12;
    const markerR = 4;
    const offset = markerR + gap;
    const statsW = 118;
    const statsH = 58;
    const dotInset = 0.45;

    const markerX = clamp(p.xPercent, dotInset, 100 - dotInset);
    const markerY = clamp(p.curveYPercent, dotInset, 100 - dotInset);
    const mx = (p.xPercent / 100) * w;
    const my = (p.curveYPercent / 100) * h;

    const canAbove = my - offset - statsH >= edge;
    const canBelow = my + offset + statsH <= h - edge;
    const canRight = mx + offset + statsW <= w - edge;
    const canLeft = mx - offset - statsW >= edge;

    type Placement = "above" | "below" | "left" | "right";
    let placement: Placement;

    if (canAbove || canBelow) {
      const spaceAbove = my - edge;
      const spaceBelow = h - edge - my;
      if (canAbove && canBelow) {
        placement = spaceAbove >= spaceBelow ? "above" : "below";
      } else {
        placement = canAbove ? "above" : "below";
      }
    } else if (canRight || canLeft) {
      placement = canRight && (!canLeft || mx < w / 2) ? "right" : "left";
    } else {
      placement = my < h / 2 ? "below" : "above";
    }

    let anchorX = mx;
    if (placement === "above" || placement === "below") {
      const half = statsW / 2;
      anchorX = clamp(anchorX, edge + half, w - edge - half);
    }

    let anchorY = my;
    if (placement === "left" || placement === "right") {
      const half = statsH / 2;
      anchorY = clamp(anchorY, edge + half, h - edge - half);
    }

    return {
      markerX,
      markerY,
      anchorLeft: `${anchorX}px`,
      anchorTop: `${anchorY}px`,
      placement,
    };
  }

  private renderCurveProbe() {
    const p = this.curveProbe!;
    const layout = this.getProbeLayout(p);
    const y1 = p.fromTop ? 0 : 100;
    const dbSign = p.magnitudeDb >= 0 ? "+" : "";
    return html`
      <svg
        class="curve-probe-overlay"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <line
          class="curve-probe-line"
          x1=${layout.markerX}
          y1=${y1}
          x2=${layout.markerX}
          y2=${layout.markerY}
        />
      </svg>
      <div
        class="curve-probe-marker"
        style="left: ${layout.markerX}%; top: ${layout.markerY}%;"
      ></div>
      <div
        class="curve-probe-anchor"
        style="left: ${layout.anchorLeft}; top: ${layout.anchorTop};"
      >
        <div class="curve-probe-stats placement-${layout.placement}">
        <div class="probe-row">
          <span class="probe-label">Freq</span>
          <span class="probe-value"
            >${formatFrequency(p.frequency)}
            ${formatFrequencyUnit(p.frequency)}</span
          >
        </div>
        <div class="probe-row">
          <span class="probe-label">Gain</span>
          <span class="probe-value probe-db"
            >${dbSign}${p.magnitudeDb.toFixed(2)} dB</span
          >
        </div>
        <div class="probe-row">
          <span class="probe-label">Phase</span>
          <span class="probe-value" style="color: #7d7d7d;"
            >${p.phaseDeg.toFixed(1)}°</span
          >
        </div>
        </div>
      </div>
    `;
  }

  private getVisualisationBounds() {
    return (
      this.frequencyResponseCanvas?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      }
    );
  }

  private refreshCurveProbeAtFrequency(frequency: number) {
    if (!this.runtime) return;
    const bounds = this.getVisualisationBounds();
    if (bounds.width <= 0) return;

    const nyquist = this.runtime.audioCtx.sampleRate / 2;
    const xPercent =
      toLog10(frequency, 10, nyquist) * 100;
    const { magnitudeDb, phaseDeg } =
      this.runtime.getEqResponseAtFrequency(frequency);
    const relY =
      (magnitudeDb - CURVE_MIN_DB) / (CURVE_MAX_DB - CURVE_MIN_DB);
    const curveYPercent = clamp((1 - relY) * 100, 0, 100);

    this.curveProbe = {
      xPercent,
      curveYPercent,
      fromTop: magnitudeDb < 0,
      frequency,
      magnitudeDb,
      phaseDeg,
    };
  }

  private updateCurveProbeFromPointer(evt: PointerEvent) {
    if (!this.runtime) return;
    const bounds = this.getVisualisationBounds();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const relX = clamp((evt.clientX - bounds.left) / bounds.width, 0, 1);
    const frequency = toLin(relX, 10, this.runtime.audioCtx.sampleRate / 2);
    this.refreshCurveProbeAtFrequency(frequency);
  }

  private onVisualisationContextMenu = (evt: MouseEvent) => {
    const target = evt.target as HTMLElement;
    if (target.closest(".filter-handle-positioner")) return;
    evt.preventDefault();
    evt.stopPropagation();
  };

  private onVisualisationPointerDown = (evt: PointerEvent) => {
    if (evt.button !== 2 || !this.runtime) return;
    const target = evt.target as HTMLElement;
    if (target.closest(".filter-handle-positioner")) return;

    this.curveContextMenu = null;

    evt.preventDefault();
    (evt.currentTarget as HTMLElement).setPointerCapture(evt.pointerId);
    this.curveProbePointerId = evt.pointerId;
    this.updateCurveProbeFromPointer(evt);
  };

  private onVisualisationPointerMove = (evt: PointerEvent) => {
    if (this.curveProbePointerId !== evt.pointerId) return;
    this.updateCurveProbeFromPointer(evt);
  };

  private onVisualisationPointerUp = (evt: PointerEvent) => {
    if (this.curveProbePointerId !== evt.pointerId) return;
    const target = evt.currentTarget as HTMLElement;
    if (target.hasPointerCapture(evt.pointerId)) {
      target.releasePointerCapture(evt.pointerId);
    }
    this.curveProbePointerId = null;
    this.curveProbe = null;
  };

  private renderGridX(x: number) {
    return svg`<line
      class="grid-x"
      x1=${x}
      y1="0"
      x2=${x}
      y2="10"
    />`;
  }

  private renderGridY(db: number) {
    let relY = (db + 15) / 30;
    let y = relY * 10;
    return svg`<line
      class="grid-y"
      x1="0"
      y1=${y}
      x2="100"
      y2=${y}
    />`;
  }

  private renderFilterHandle(spec: WEQ8Filter, idx: number) {
    if (!this.runtime) return;
    let [x, y] = this.getFilterPositionInVisualisation(spec);
    return html`<div
      class="filter-handle-positioner"
      style="transform: translate(${x}px,${y}px)"
      @pointerdown=${(evt: PointerEvent) =>
        this.startDraggingFilterHandle(evt, idx)}
      @pointerup=${(evt: PointerEvent) =>
        this.stopDraggingFilterHandle(evt, idx)}
      @pointermove=${(evt: PointerEvent) => this.dragFilterHandle(evt, idx)}
      @wheel=${(evt: WheelEvent) => this.onWheelFilterHandle(evt, idx)}
    >
      <div
        class="${classMap({
          "filter-handle": true,
          bypassed: spec.bypass,
          selected: idx === this.selectedFilterIdx,
        })}"
        @dblclick=${(evt: MouseEvent) =>
          this.onFilterHandleDoubleClick(evt, idx, spec)}
      >
        ${getActiveBandDisplayNumber(this.runtime.spec, idx) ?? ""}
      </div>
    </div>`;
  }

  private getFilterPositionInVisualisation(spec: WEQ8Filter): [number, number] {
    if (!this.runtime) return [0, 0];
    let width = this.analyserCanvas?.offsetWidth ?? 0;
    let height = this.analyserCanvas?.offsetHeight ?? 0;
    let x =
      toLog10(spec.frequency, 10, this.runtime.audioCtx.sampleRate / 2) * width;
    let y = height - ((spec.gain + 15) / 30) * height;
    if (!filterHasGain(spec.type)) {
      y = height - toLog10(spec.Q, 0.1, 18) * height;
    }
    return [x, y];
  }

  private onFilterHandleDoubleClick(
    evt: MouseEvent,
    idx: number,
    spec: WEQ8Filter
  ) {
    evt.preventDefault();
    evt.stopPropagation();
    if (!this.runtime || !filterHasGain(spec.type)) return;
    this.selectedFilterIdx = idx;
    this.runtime.setFilterGain(idx, 0);
  }

  private startDraggingFilterHandle(evt: PointerEvent, idx: number) {
    (evt.target as Element).setPointerCapture(evt.pointerId);
    this.dragStates = { ...this.dragStates, [idx]: evt.pointerId };
    this.selectedFilterIdx = idx;
    evt.preventDefault();
  }

  private stopDraggingFilterHandle(evt: PointerEvent, idx: number) {
    if (this.dragStates[idx] === evt.pointerId) {
      (evt.target as Element).releasePointerCapture(evt.pointerId);
      this.dragStates = { ...this.dragStates, [idx]: null };
    }
  }

  private dragFilterHandle(evt: PointerEvent, idx: number) {
    if (this.runtime && this.dragStates[idx] === evt.pointerId) {
      let filterType = this.runtime.spec[idx].type;
      let canvasBounds =
        this.frequencyResponseCanvas?.getBoundingClientRect() ?? {
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          };
      let pointerX = evt.clientX - canvasBounds.left;
      let pointerY = evt.clientY - canvasBounds.top;
      let pointerFreq = toLin(
        pointerX / canvasBounds.width,
        10,
        this.runtime.audioCtx.sampleRate / 2
      );
      this.runtime.setFilterFrequency(idx, pointerFreq);

      let relY = 1 - pointerY / canvasBounds.height;
      if (!filterHasGain(filterType)) {
        let pointerQ = toLin(relY, 0.1, 18);
        this.runtime.setFilterQ(idx, pointerQ);
      } else {
        let pointerGain = clamp(relY * 30 - 15, -15, 15);
        this.runtime.setFilterGain(idx, pointerGain);
      }
    }
  }

  private onWheelFilterHandle(evt: WheelEvent, idx: number) {
    if (!this.runtime) return;
    evt.preventDefault();
    
    const spec = this.runtime.spec[idx];
    const direction = evt.deltaY < 0 ? 1 : -1; // up scroll boosts, down scroll cuts

    const minFreq = 10;
    const maxFreq = this.runtime.audioCtx.sampleRate / 2;
    const minQ = 0.1;
    const maxQ = 18;

    if (evt.shiftKey && evt.altKey) {
      // 1. Shift + Alt + Scroll: Adjust Frequency with ultra-high precision (smaller log step)
      const currentLog = toLog10(spec.frequency, minFreq, maxFreq);
      const step = 0.001 * direction; 
      const targetFreq = toLin(clamp(currentLog + step, 0, 1), minFreq, maxFreq);
      this.runtime.setFilterFrequency(idx, targetFreq);
    } else if (evt.ctrlKey && evt.altKey) {
      // 2. Ctrl + Alt + Scroll: Adjust Q value by exactly 0.01 linearly (if supported)
      if (filterHasQ(spec.type)) {
        const step = 0.01 * direction;
        const targetQ = clamp(spec.Q + step, minQ, maxQ);
        this.runtime.setFilterQ(idx, targetQ);
      }
    } else if (evt.shiftKey) {
      // 3. Shift + Scroll: Adjust Frequency (Normal high precision)
      const currentLog = toLog10(spec.frequency, minFreq, maxFreq);
      const step = 0.01 * direction;
      const targetFreq = toLin(clamp(currentLog + step, 0, 1), minFreq, maxFreq);
      this.runtime.setFilterFrequency(idx, targetFreq);
    } else if (evt.ctrlKey) {
      // 4. Ctrl + Scroll: Adjust Q value (Normal log-spaced precision) (if supported)
      if (filterHasQ(spec.type)) {
        const currentLog = toLog10(spec.Q, minQ, maxQ);
        const step = 0.01 * direction;
        const targetQ = toLin(clamp(currentLog + step, 0, 1), minQ, maxQ);
        this.runtime.setFilterQ(idx, targetQ);
      }
    } else if (evt.altKey) {
      // 5. Alt + Scroll: Adjust Gain by 0.1 dB (if supported by filter type)
      if (filterHasGain(spec.type)) {
        const step = 0.1 * direction;
        const targetGain = clamp(spec.gain + step, -15, 15);
        this.runtime.setFilterGain(idx, targetGain);
      }
    } else {
      // 6. Normal Scroll: Adjust Gain by 0.5 dB
      if (filterHasGain(spec.type)) {
        const step = 0.5 * direction;
        const targetGain = clamp(spec.gain + step, -15, 15);
        this.runtime.setFilterGain(idx, targetGain);
      }
    }
  }
}
