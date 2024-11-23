import { EventType } from '@rrweb/types';
import type { eventWithTime, fullSnapshotEvent } from '@rrweb/types';
import {
  type BuildCache,
  type Mirror,
  buildNodeWithSN,
  createCache,
  createMirror,
} from 'rrweb-snapshot';
import html2canvas from 'html2canvas';

// Minimal set of components needed:
// - Mirror (from rrweb-snapshot) - For maintaining node mapping and metadata
// - buildNodeWithSN (from rrweb-snapshot) - Core node building logic
// - createCache (from rrweb-snapshot) - For caching during reconstruction
// - iframe (hidden) - For minimal DOM implementation

export interface DOMReconstructionResult {
  document: Document | null;
  imageDataUrl?: string;
  error?: string;
}

export class DOMReconstructor {
  private mirror: Mirror;
  private cache: BuildCache;
  private hiddenContainer: HTMLDivElement;
  private hiddenIframe: HTMLIFrameElement;

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
          scale: 1,
          foreignObjectRendering: true,
        });
        
        const imageDataUrl = canvas.toDataURL('image/png');
        
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
