import type { eventWithTime, fullSnapshotEvent } from '@rrweb/types';
import { Replayer, type playerConfig } from 'rrweb';
import type { SemanticLabel } from './types';

export class EnhancedReplayer extends Replayer {
  private semanticLabels: SemanticLabel[] = [];
  private overlayContainer: HTMLDivElement | null = null;
  
  constructor(
    events: Array<eventWithTime | string>,
    config?: Partial<playerConfig>,
    semanticLabels?: SemanticLabel[]
  ) {
    super(events, config);
    if (semanticLabels) {
      this.semanticLabels = semanticLabels;
    }
    this.initializeOverlayContainer();
  }

  private initializeOverlayContainer() {
    if (this.wrapper) {
      this.overlayContainer = document.createElement('div');
      this.overlayContainer.className = 'semantic-overlay-container';
      this.overlayContainer.style.position = 'absolute';
      this.overlayContainer.style.top = '0';
      this.overlayContainer.style.left = '0';
      this.overlayContainer.style.width = '100%';
      this.overlayContainer.style.height = '100%';
      this.overlayContainer.style.pointerEvents = 'none';
      this.wrapper.appendChild(this.overlayContainer);
    }
  }

  protected override rebuildFullSnapshot(
    event: fullSnapshotEvent & { timestamp: number },
    isSync = false
  ): void {
    // Call original implementation
    super.rebuildFullSnapshot(event, isSync);
    
    // Add semantic labels that exist at this timestamp
    this.attachSemanticLabels(event.timestamp);
  }

  private attachSemanticLabels(timestamp: number): void {
    if (!this.overlayContainer) return;

    // Clear existing overlays
    this.overlayContainer.innerHTML = '';
    
    // Find all semantic labels that should exist at this timestamp
    const relevantLabels = this.semanticLabels.filter(
      (label) => label.timestamp <= timestamp
    );
    
    // Attach labels to DOM
    for (const label of relevantLabels) {
      const element = this.mirror.getNode(label.elementId);
      if (element) {
        this.attachLabelToElement(element as HTMLElement, label);
      }
    }
  }

  private attachLabelToElement(
    element: HTMLElement,
    label: SemanticLabel
  ): void {
    if (!this.overlayContainer) return;

    // Create and attach semantic label overlay
    const overlay = document.createElement('div');
    overlay.className = 'semantic-label-overlay';
    overlay.style.position = 'absolute';
    overlay.style.left = `${label.boundingBox.x}px`;
    overlay.style.top = `${label.boundingBox.y}px`;
    overlay.style.width = `${label.boundingBox.width}px`;
    overlay.style.height = `${label.boundingBox.height}px`;
    overlay.style.border = '2px solid rgba(75, 85, 99, 0.5)';
    overlay.style.borderRadius = '4px';
    overlay.style.backgroundColor = 'rgba(75, 85, 99, 0.1)';
    overlay.style.pointerEvents = 'none';

    // Add label tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'semantic-label-tooltip';
    tooltip.textContent = `${label.label} (${Math.round(label.confidence * 100)}%)`;
    tooltip.style.position = 'absolute';
    tooltip.style.top = '-25px';
    tooltip.style.left = '0';
    tooltip.style.backgroundColor = 'rgba(75, 85, 99, 0.9)';
    tooltip.style.color = 'white';
    tooltip.style.padding = '2px 6px';
    tooltip.style.borderRadius = '4px';
    tooltip.style.fontSize = '12px';
    tooltip.style.whiteSpace = 'nowrap';
    
    overlay.appendChild(tooltip);
    this.overlayContainer.appendChild(overlay);
  }

  public override play(timeOffset = 0) {
    super.play(timeOffset);
    // Ensure semantic labels are shown when playback starts
    const currentTime = this.getCurrentTime();
    this.attachSemanticLabels(currentTime);
  }

  public override pause() {
    super.pause();
    // Update semantic labels when paused
    const currentTime = this.getCurrentTime();
    this.attachSemanticLabels(currentTime);
  }

  public override resume(timeOffset = 0) {
    super.resume(timeOffset);
    // Update semantic labels when resumed
    const currentTime = this.getCurrentTime();
    this.attachSemanticLabels(currentTime);
  }

  public override destroy() {
    if (this.overlayContainer) {
      this.overlayContainer.remove();
      this.overlayContainer = null;
    }
    super.destroy();
  }
}
