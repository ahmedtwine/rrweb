import type { eventWithTime } from '@rrweb/types';
import { SemanticProcessor } from './processor';
import type { EnhancedEvent } from './types';

/**
 * Enhances rrweb events with semantic labels while preserving the original event structure
 * This is designed to be compatible with InteractivePlayer's existing functionality
 */
export async function enhanceEventsWithSemanticLabels(
  events: eventWithTime[]
): Promise<EnhancedEvent[]> {
  const processor = new SemanticProcessor();
  
  try {
    // Process the session to get semantic labels
    const { semanticMapping } = await processor.processSession(events);
    
    // Create a timestamp to labels map for efficient lookup
    const labelsByTimestamp = new Map();
    // biome-ignore lint/complexity/noForEach: <explanation>
    semanticMapping.forEach(label => {
      const labels = labelsByTimestamp.get(label.timestamp) || [];
      labels.push(label);
      labelsByTimestamp.set(label.timestamp, labels);
    });
    
    // Enhance each event with its corresponding semantic labels
    const enhancedEvents = events.map(event => {
      const labels = labelsByTimestamp.get(event.timestamp);
      if (labels) {
        return {
          ...event,
          semanticLabels: labels,
        };
      }
      console.log(` EnhancedEvent:`, enhancedEvents);
    });
  } finally {
    // Clean up processor resources
    processor.destroy();
  }
}
