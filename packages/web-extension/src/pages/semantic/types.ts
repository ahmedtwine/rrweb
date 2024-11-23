import type { eventWithTime } from '@rrweb/types';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SemanticLabel {
  elementId: string;          // Unique identifier to map to DOM element
  timestamp: number;          // To sync with rrweb events
  boundingBox: BoundingBox;   // Position and size of the label overlay
  label: string;             // AI-generated semantic label
  confidence: number;        // Confidence score from AI model (0-1)
}

export interface AILabel {
  box: BoundingBox;         // Bounding box coordinates from AI model
  description: string;      // The detected text or label
  confidence: number;       // Confidence score from AI model
}

export interface EnhancedEvent extends eventWithTime {
  semanticLabels?: SemanticLabel[];
}

export interface ProcessedSession {
  id: string;
  originalEvents: eventWithTime[];
  semanticMapping: SemanticLabel[];
}
