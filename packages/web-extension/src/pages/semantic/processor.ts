import { Client } from '@gradio/client';
import { EventType, IncrementalSource, type eventWithTime, type fullSnapshotEvent, type incrementalSnapshotEvent } from '@rrweb/types';
import html2canvas from 'html2canvas';
import { Replayer } from 'rrweb';
import { type Mirror, NodeType, createMirror } from 'rrweb-snapshot';
import { v4 as uuidv4 } from 'uuid';
import type { ProcessedSession, SemanticLabel } from './types';

export class SemanticProcessor {
  private mirror: Mirror;
  private virtualDom: Document;
  private client: Promise<any>;
  private tempContainer: HTMLElement;
  
  constructor() {
    this.mirror = createMirror();
    this.virtualDom = document.implementation.createHTMLDocument();
    this.client = Client.connect('microsoft/OmniParser');
    
    // Create a temporary container in the actual document
    this.tempContainer = document.createElement('div');
    this.tempContainer.style.position = 'absolute';
    this.tempContainer.style.left = '-9999px';
    this.tempContainer.style.width = '1024px';  // Fixed width for consistent rendering
    this.tempContainer.style.height = '768px';  // Fixed height for consistent rendering
    document.body.appendChild(this.tempContainer);
  }

  async processSession(events: eventWithTime[]): Promise<ProcessedSession> {
    const sessionId = uuidv4();
    const semanticMapping: SemanticLabel[] = [];
    
    try {
      // Step 1: Get the initial full snapshot
      const firstFullSnapshot = events.find(
        (e) => e.type === EventType.FullSnapshot
      ) as fullSnapshotEvent;
      
      if (!firstFullSnapshot) {
        throw new Error('No full snapshot found in session');
      }

      // Step 2: Create a temporary replayer to rebuild the DOM
      const replayer = new Replayer(events, {
        root: this.tempContainer,
        skipInactive: true,
        showWarning: false,
      });

      // Step 3: Process the initial snapshot for semantic labels
      const initialLabels = await this.processSnapshot(this.tempContainer, firstFullSnapshot.timestamp);
      semanticMapping.push(...initialLabels);

      // Step 4: Process incremental snapshots
      for (const event of events) {
        if (
          event.type === EventType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          const newLabels = await this.processIncrementalSnapshot(event);
          semanticMapping.push(...newLabels);
        }
      }

      replayer.destroy();

      return {
        id: sessionId,
        originalEvents: events,
        semanticMapping,
      };
    } finally {
      // Clean up
      this.tempContainer.innerHTML = '';
    }
  }

  private async processSnapshot(
    element: HTMLElement,
    timestamp: number
  ): Promise<SemanticLabel[]> {
    try {
      const canvas = await html2canvas(element, {
        logging: false,
        useCORS: true,
        scale: 1,
        width: 1024,  // Match container size
        height: 768,  // Match container size
        backgroundColor: '#ffffff',
      });

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => resolve(blob!), 'image/webp', 0.95);
      });

      const client = await this.client;
      const result = await client.predict('/process', {
        image_input: blob,
        box_threshold: 0.05,
        iou_threshold: 0.1,
      });

      const coordinates = result.data[2];
      const textResults = result.data[1].split('\n').filter((line: string) => line.trim().length > 0);

      let coordinateObject: Record<string, number[]>;

      if (typeof coordinates === 'string') {
        coordinateObject = JSON.parse(coordinates.replace(/'/g, '"'));
      } else {
        coordinateObject = coordinates;
      }

      return Object.entries(coordinateObject)
        .map(([id, coords]): SemanticLabel | null => {
          if (!coords || !Array.isArray(coords) || coords.length !== 4) {
            console.warn(`Invalid coordinates for ID ${id}:`, coords);
            return null;
          }

          const coordArray = coords.map(Number);
          if (coordArray.some(Number.isNaN)) {
            console.warn(`Invalid coordinate values for ID ${id}:`, coords);
            return null;
          }

          const [x, y, width, height] = coordArray;
          const text = textResults
            .find((line) => line.startsWith(`Text Box ID ${id}:`))
            ?.replace(/^Text Box ID \d+: /, '')
            ?.trim();

          if (!text) return null;

          return {
            elementId: id,
            timestamp,
            boundingBox: {
              x,
              y,
              width,
              height
            },
            label: text,
            confidence: 0.95 // Default confidence for OmniParser
          };
        })
        .filter((label): label is SemanticLabel => label !== null);
    } catch (error) {
      console.error('Failed to process snapshot:', error);
      return [];
    }
  }

  private async processIncrementalSnapshot(
    event: incrementalSnapshotEvent
  ): Promise<SemanticLabel[]> {
    // For now, just return empty array for incremental snapshots
    return [];
  }

  destroy() {
    // Clean up
    if (this.tempContainer?.parentNode) {
      this.tempContainer.parentNode.removeChild(this.tempContainer);
    }
  }
}
