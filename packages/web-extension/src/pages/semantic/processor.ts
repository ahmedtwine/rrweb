import { Client } from '@gradio/client';
import { EventType, IncrementalSource } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import html2canvas from 'html2canvas';
import { v4 as uuidv4 } from 'uuid';
import type { AILabel, ProcessedSession, SemanticLabel } from './types';

type BoundingBox = [number, number, number, number]; // [x, y, width, height]

interface GradioResponse {
  data: [
    {
      // image output
      path: string;
      url: string;
      size: null;
      orig_name: string;
      mime_type: null;
      is_stream: boolean;
      meta: { _type: string };
    },
    string, // parsed text
    Record<string, BoundingBox>, // coordinates
  ];
}

export class SemanticProcessor {
  private tempContainer: HTMLDivElement | null = null;
  private client: Client | null = null;

  constructor() {
    this.setupTempContainer();
  }

  private setupTempContainer() {
    // Create a temporary container for html2canvas
    this.tempContainer = document.createElement('div');
    this.tempContainer.style.position = 'absolute';
    this.tempContainer.style.left = '-9999px';
    this.tempContainer.style.width = '1024px';
    this.tempContainer.style.height = '768px';
    document.body.appendChild(this.tempContainer);
  }

  private async initClient() {
    if (!this.client) {
      const  client = await Client.connect("microsoft/OmniParser");
      this.client = client;
    }
    return this.client;
  }

  public async processSession(events: eventWithTime[]): Promise<ProcessedSession> {
    const semanticMapping: SemanticLabel[] = [];
    let lastFullSnapshot: eventWithTime | null = null;

    for (const event of events) {
      if (event.type === EventType.FullSnapshot) {
        lastFullSnapshot = event;
        const labels = await this.processSnapshot(event);
        semanticMapping.push(...labels);
      } else if (
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation &&
        lastFullSnapshot
      ) {
        const labels = await this.processIncrementalSnapshot(event, lastFullSnapshot);
        semanticMapping.push(...labels);
      }
    }

    return {
      semanticMapping,
      processedAt: new Date().toISOString(),
    };
  }

  private async processSnapshot(event: eventWithTime): Promise<SemanticLabel[]> {
    if (!this.tempContainer) {
      throw new Error('Temp container not initialized');
    }

    // Clear previous content
    this.tempContainer.innerHTML = '';

    // Create a new iframe
    const iframe = document.createElement('iframe');
    iframe.style.width = '1024px';
    iframe.style.height = '768px';
    this.tempContainer.appendChild(iframe);

    if (!iframe.contentDocument) {
      throw new Error('Failed to create iframe document');
    }

    // Rebuild DOM in iframe
    iframe.contentDocument.documentElement.innerHTML = event.data.node.toString();

    try {
      const canvas = await html2canvas(iframe.contentDocument.body, {
        scale: 2,
        useCORS: true,
        logging: false,
      });

      const canvasWidth = canvas.width / 2;
      const canvasHeight = canvas.height / 2;

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => resolve(blob!), 'image/webp', 0.95);
      });

      const client = await this.initClient();
      const result = (await client.predict('/process', {
        image_input: blob,
        box_threshold: 0.05,
        iou_threshold: 0.1,
      })) as GradioResponse;

      const coordinates = result.data[2];
      const parsedText = result.data[1].split('\n').filter((line) => line.trim().length > 0);

      let coordinateObject: Record<string, number[]>;

      if (typeof coordinates === 'string') {
        try {
          coordinateObject = JSON.parse(coordinates.replace(/'/g, '"'));
        } catch (e) {
          console.error('Error parsing coordinates JSON:', e);
          return [];
        }
      } else {
        coordinateObject = coordinates;
      }

      // Convert coordinates to actual pixel values and create semantic labels
      const aiLabels: AILabel[] = Object.entries(coordinateObject)
        .map(([id, coords]): AILabel | null => {
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
          return {
            id: uuidv4(),
            text: parsedText[Number.parseInt(id)] || '',
            boundingBox: {
              x: (x * canvasWidth) / 100,
              y: (y * canvasHeight) / 100,
              width: (width * canvasWidth) / 100,
              height: (height * canvasHeight) / 100,
            },
            confidence: 1.0,
            timestamp: event.timestamp,
          };
        })
        .filter((label): label is AILabel => label !== null);

      return aiLabels.map((aiLabel) => ({
        id: aiLabel.id,
        text: aiLabel.text,
        boundingBox: aiLabel.boundingBox,
        confidence: aiLabel.confidence,
        timestamp: aiLabel.timestamp,
        type: 'text',
      }));
    } catch (error) {
      console.error('Error processing snapshot:', error);
      return [];
    } finally {
      // Clean up
      iframe.remove();
    }
  }

  private async processIncrementalSnapshot(
    event: eventWithTime,
    lastFullSnapshot: eventWithTime
  ): Promise<SemanticLabel[]> {
    // For now, we'll reprocess the full snapshot when we get a mutation
    // In the future, we can optimize this to only process the changed areas
    return this.processSnapshot(lastFullSnapshot);
  }

  public destroy() {
    if (this.tempContainer) {
      this.tempContainer.remove();
      this.tempContainer = null;
    }
    this.client = null;
  }
}
