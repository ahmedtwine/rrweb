import { EventType } from '@rrweb/types';
import type { eventWithTime, fullSnapshotEvent } from '@rrweb/types';
import html2canvas from 'html2canvas';
import {
  type BuildCache,
  type Mirror,
  buildNodeWithSN,
  createCache,
  createMirror,
} from 'rrweb-snapshot';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SemanticLabel {
  id: string; // Unique identifier to map to DOM element
  timestamp: number; // To sync with rrweb events
  label: string; // AI-generated semantic label
  confidence: number; // Confidence score from AI model (0-1)
  bbox: BoundingBox; // Position and size of the label overlay
}

export interface AILabel {
  box: BoundingBox; // Bounding box coordinates from AI model
  description: string; // The detected text or label
  confidence: number; // Confidence score from AI model
}

export interface EnhancedEvent extends eventWithTime {
  semanticLabels?: SemanticLabel[];
}

export interface ProcessedSession {
  id: string;
  originalEvents: eventWithTime[];
  semanticMapping: SemanticLabel[];
}

export interface DOMReconstructionResult {
  document: Document | null;
  imageDataUrl?: string;
  error?: string;
}

interface AIAnalysisResult {
  text: string;
  bbox: number[];
  score: number;
}

interface AIAnalysisResponse {
  results: AIAnalysisResult[];
  error?: string;
}

// Convert server bbox [x1, y1, x2, y2] to our format {x, y, width, height}
function convertBBoxToBox(bbox: number[]): BoundingBox {
  return {
    x: bbox[0],
    y: bbox[1],
    width: bbox[2] - bbox[0],
    height: bbox[3] - bbox[1]
  };
}

// Convert AIAnalysisResult to SemanticLabel
function convertToSemanticLabel(result: AIAnalysisResult, timestamp: number): SemanticLabel {
  return {
    id: crypto.randomUUID(),
    timestamp,
    label: result.text,
    confidence: result.score,
    bbox: convertBBoxToBox(result.bbox)
  };
}

export class DOMReconstructor {
  private mirror: Mirror;
  private cache: BuildCache;
  private hiddenContainer: HTMLDivElement;
  private hiddenIframe: HTMLIFrameElement;
  private analysisResults: AIAnalysisResult[] | null = null;
  private isPolling = false;
  private currentJobId: string | null = null;
  private semanticLabelSubscribers: ((labels: SemanticLabel[], imageData: string) => void)[] = [];

  constructor() {
    this.mirror = createMirror();
    this.cache = createCache();
    
    // Create a hidden container
    this.hiddenContainer = document.createElement('div');
    this.hiddenContainer.style.position = 'absolute';
    this.hiddenContainer.style.left = '-9999px';
    this.hiddenContainer.style.top = '-9999px';
    document.body.appendChild(this.hiddenContainer);

    // Create a hidden iframe for DOM implementation
    this.hiddenIframe = document.createElement('iframe');
    this.hiddenIframe.style.width = '1024px'; // Set fixed width for consistent snapshots
    this.hiddenIframe.style.height = '768px'; // Set fixed height for consistent snapshots
    this.hiddenIframe.style.border = 'none';
    this.hiddenIframe.style.position = 'absolute';
    this.hiddenContainer.appendChild(this.hiddenIframe);

    // Initialize iframe document
    if (!this.hiddenIframe.contentDocument) {
      throw new Error('Failed to create iframe document');
    }
    
    this.hiddenIframe.contentDocument.open();
    this.hiddenIframe.contentDocument.write('<!DOCTYPE html><html><head></head><body></body></html>');
    this.hiddenIframe.contentDocument.close();
  }

  public async reconstructFromEvents(events: eventWithTime[]): Promise<DOMReconstructionResult> {
    try {
      const fullSnapshot = events.find(
        (event): event is fullSnapshotEvent =>
          event.type === EventType.FullSnapshot,
      );

      if (!fullSnapshot) {
        return {
          document: null,
          error: 'No full snapshot found in events'
        };
      }

      const iframeDoc = this.hiddenIframe.contentDocument;
      if (!iframeDoc) {
        throw new Error('No iframe document available');
      }

      // Clear existing content
      iframeDoc.documentElement.innerHTML = '';

      // Reset state
      this.mirror.reset();
      this.cache = createCache();

      // Build the DOM tree using rrweb-snapshot's buildNodeWithSN
      buildNodeWithSN(fullSnapshot.data.node, {
        doc: iframeDoc,
        mirror: this.mirror,
        hackCss: true,
        cache: this.cache,
      });

      // Generate image snapshot using html2canvas
      try {
        const canvas = await html2canvas(iframeDoc.documentElement, {
          useCORS: true,
          allowTaint: true,
          logging: false,
          width: 1024, // Match iframe dimensions
          height: 768,
          foreignObjectRendering: true,
        });
        
        const imageDataUrl = canvas.toDataURL('image/png');
        
        // Start AI analysis asynchronously
        this.analyzeImage(imageDataUrl).catch(error => {
          console.error('Error analyzing image:', error);
        });

        return {
          document: iframeDoc,
          imageDataUrl,
        };
      } catch (imageError) {
        console.error('Error generating image:', imageError);
        return {
          document: iframeDoc,
          error: 'Failed to generate image snapshot'
        };
      }
    } catch (error) {
      console.error('Error reconstructing DOM:', error);
      return {
        document: null,
        error: 'Failed to reconstruct DOM'
      };
    }
  }

  public subscribeToSemanticLabels(callback: (labels: SemanticLabel[], imageData: string) => void): () => void {
    this.semanticLabelSubscribers.push(callback);
    return () => {
      this.semanticLabelSubscribers = this.semanticLabelSubscribers.filter(cb => cb !== callback);
    };
  }

  private notifySemanticLabelSubscribers(labels: SemanticLabel[], imageData: string) {
    this.semanticLabelSubscribers.forEach(callback => callback(labels, imageData));
  }

  private async pollResults(jobId: string, maxAttempts = 120, interval = 10000): Promise<AIAnalysisResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`https://trayn.piques.xyz/analyze/results/${jobId}`);
        
        if (!response.ok) {
          if (response.status === 404) {
            // Job not ready yet, continue polling
            await new Promise(resolve => setTimeout(resolve, interval));
            continue;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Handle streaming response
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body available');
        }

        let jsonText = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          jsonText += new TextDecoder().decode(value);
        }

        const data: AIAnalysisResponse = JSON.parse(jsonText);
        if (data.error) {
          throw new Error(data.error);
        }

        // Only return if we have actual results
        if (data.results && data.results.length > 0) {
          return data;
        }

        // If no results yet, continue polling
        console.log(`No results yet, attempt ${attempt + 1}/${maxAttempts}...`);
        await new Promise(resolve => setTimeout(resolve, interval));
        continue;

      } catch (error) {
        if (attempt === maxAttempts - 1) {
          throw error;
        }
        // If not the last attempt, continue polling
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
    throw new Error('Max polling attempts reached without getting results');
  }

  private async analyzeImage(dataUrl: string): Promise<AIAnalysisResult[]> {
    if (this.isPolling) {
      console.log('Analysis already in progress, skipping new request');
      return [];
    }

    try {
      // Notify subscribers immediately with the image for debugging
      this.notifySemanticLabelSubscribers([], dataUrl);

      // Convert data URL to blob properly
      const base64Data = dataUrl.split(',')[1];
      const binaryData = atob(base64Data);
      const array = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        array[i] = binaryData.charCodeAt(i);
      }
      const blob = new Blob([array], { type: 'image/png' });

      // Create FormData and append the image
      const formData = new FormData();
      formData.append('image', blob, 'screenshot.png');

      // Submit the job
      const submitResponse = await fetch('https://trayn.piques.xyz/analyze/upload', {
        method: 'POST',
        body: formData,
      });

      if (!submitResponse.ok) {
        throw new Error(`Failed to submit job: ${submitResponse.status}`);
      }

      const { jobId } = await submitResponse.json();
      if (!jobId) {
        throw new Error('No job ID received from server');
      }

      console.log('Job submitted successfully, polling for results...');

      // Poll for results (5 second intervals, up to 5 minutes total)
      const data = await this.pollResults(jobId, 120, 10000);
      
      // Store the results directly without scaling
      this.analysisResults = data.results;

      // Convert results to semantic labels
      const timestamp = Date.now();
      const semanticLabels = data.results.map(result => 
        convertToSemanticLabel(result, timestamp)
      );

      console.log('Semantic Labels:', semanticLabels);
      this.notifySemanticLabelSubscribers(semanticLabels, dataUrl);
      
      return this.analysisResults;
    } catch (error) {
      console.error('Error analyzing image:', error);
      this.analysisResults = null;
      return [];
    }
  }

  public getAnalysisResults(): AIAnalysisResult[] | null {
    return this.analysisResults;
  }

  public getDocument(): Document | null {
    return this.hiddenIframe.contentDocument;
  }

  public destroy(): void {
    if (this.hiddenContainer) {
      this.hiddenContainer.remove();
    }
    this.mirror.reset();
    this.cache = createCache();
  }
}
