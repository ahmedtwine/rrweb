import {
  Box,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Center,
  Code,
  Text,
  VStack,
  useToast,
} from '@chakra-ui/react';
import { Client } from '@gradio/client';
import { EventType, IncrementalSource, MouseInteractions } from '@rrweb/types';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Replayer from 'rrweb-player';
import { getEvents, getSession } from '~/utils/storage';
import 'rrweb-player/dist/style.css';
import html2canvas from 'html2canvas';
import type { ReplayPlugin, eventWithTime } from 'rrweb';
import type { Mirror } from 'rrweb-snapshot';

type BoundingBox = [number, number, number, number]; // [x, y, width, height]

interface ReplayerContext {
  replayer: Replayer;
  event: eventWithTime;
  mirror: Mirror;
}

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

const createClickHighlightPlugin = (): ReplayPlugin => {
  return {
    handler(event, isSync, context) {
      if (
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.MouseInteraction &&
        event.data.type === MouseInteractions.Click
      ) {
        const target = context.replayer
          .getMirror()
          .getNode(event.data.id) as HTMLElement | null;
        if (!target) return;

        // Remove any existing masking overlay
        const overlay = target.querySelector('div');
        if (overlay && overlay.style.backdropFilter) {
          target.removeChild(overlay);
        }

        target.style.border = '2px solid #4A90E2';
        target.style.boxShadow = '0 0 10px 0 rgba(74, 144, 226, 0.5)';
        target.style.transform = 'scale(1.15)';
        target.style.transition = 'all 0.3s ease';
        target.style.borderRadius = '16px';

        setTimeout(() => {
          target.style.border = '';
          target.style.boxShadow = '';
          target.style.transform = '';
          target.style.transition = '';
          target.style.borderRadius = '';
        }, 500);
      }
    },
  };
};

const createMutationHighlightPlugin = (): ReplayPlugin => {
  const applyMaskingEffect = (iframeDocument: Document) => {
    const textElements = iframeDocument.evaluate(
      '//text()[normalize-space() and not(ancestor::button) and not(ancestor::nav) and not(ancestor::header) and not(parent::script) and not(parent::style)]',
      iframeDocument,
      null,
      XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );

    for (let i = 0; i < textElements.snapshotLength; i++) {
      const textNode = textElements.snapshotItem(i);
      const parentElement = textNode?.parentElement as HTMLElement;

      if (parentElement && !parentElement.hasAttribute('data-masked')) {
        const overlay = iframeDocument.createElement('div');

        Object.assign(overlay.style, {
          position: 'absolute',
          inset: '0',
          backgroundColor: 'rgba(125, 125, 255, 0.05)',
          backdropFilter: 'blur(6px)',
          borderRadius: '16px',
          pointerEvents: 'auto',
          cursor: 'pointer',
          // Added transition for animation
          transition: 'opacity 0.3s ease, backdrop-filter 0.3s ease',
        });

        // Updated event listener to display password prompt within the iframe
        overlay.addEventListener('click', () => {
          // Create a simple password prompt within the iframe
          const passwordPrompt = iframeDocument.createElement('div');
          Object.assign(passwordPrompt.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: '#fff',
            padding: '20px',
            border: '1px solid #ccc',
            borderRadius: '8px',
            zIndex: '1000',
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
          });

          const input = iframeDocument.createElement('input');
          input.type = 'password';
          input.placeholder = 'Enter password';
          Object.assign(input.style, {
            width: '100%',
            marginBottom: '10px',
            padding: '8px',
            boxSizing: 'border-box',
          });

          const submitButton = iframeDocument.createElement('button');
          submitButton.textContent = 'Submit';
          Object.assign(submitButton.style, {
            marginRight: '10px',
            padding: '8px 16px',
          });

          const cancelButton = iframeDocument.createElement('button');
          cancelButton.textContent = 'Cancel';
          Object.assign(cancelButton.style, {
            padding: '8px 16px',
          });

          passwordPrompt.appendChild(input);
          passwordPrompt.appendChild(submitButton);
          passwordPrompt.appendChild(cancelButton);

          iframeDocument.body.appendChild(passwordPrompt);

          submitButton.addEventListener('click', () => {
            // For demo purposes, accept any input
            iframeDocument.body.removeChild(passwordPrompt);

            // Proceed to remove the overlay as before
            overlay.style.opacity = '0';
            overlay.style.backdropFilter = 'blur(0px)';
            overlay.addEventListener(
              'transitionend',
              () => {
                overlay.remove();
              },
              { once: true },
            );
          });

          cancelButton.addEventListener('click', () => {
            // Remove the password prompt
            iframeDocument.body.removeChild(passwordPrompt);
          });
        });

        if (getComputedStyle(parentElement).position === 'static') {
          parentElement.style.position = 'relative';
        }

        parentElement.appendChild(overlay);
        parentElement.setAttribute('data-masked', 'true');
      }
    }
  };

  return {
    handler(event, isSync, context) {
      const iframeDocument = context.replayer.iframe.contentDocument;
      if (!iframeDocument) return;

      if (
        event.type === EventType.FullSnapshot ||
        (event.type === EventType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation)
      ) {
        if (event.type === EventType.FullSnapshot) {
          setTimeout(() => applyMaskingEffect(iframeDocument), 100);
        } else {
          applyMaskingEffect(iframeDocument);
        }
      }
    },
  };
};

const createScreenshotAnalysisPlugin = (
  onParseResults: (results: string[]) => void,
): ReplayPlugin => {
  let analysisComplete = false;

  interface Coordinates {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface ParsedBox {
    id: string;
    coords: Coordinates;
    text: string;
  }

  const highlightMatchingElements = (
    parsedText: string,
    coordinates: Record<string, BoundingBox> | string,
    canvasWidth: number,
    canvasHeight: number,
  ) => {
    let coordinateObject: Record<string, number[]>;

    if (typeof coordinates === 'string') {
      try {
        // Replace single quotes with double quotes and parse JSON
        coordinateObject = JSON.parse(coordinates.replace(/'/g, '"'));
      } catch (e) {
        console.error('Error parsing coordinates JSON:', e);
        return;
      }
    } else {
      coordinateObject = coordinates;
    }

    console.log('Raw coordinates received:', coordinates);
    console.log('Parsed coordinates object:', coordinateObject);
    console.log('Canvas dimensions:', {
      width: canvasWidth,
      height: canvasHeight,
    });

    // Convert coordinates to actual pixel values and create boxes
    const boxes = Object.entries(coordinateObject)
      .map(([id, coords]): ParsedBox => {
        // Ensure coords exists and is an array
        if (!coords || !Array.isArray(coords) || coords.length !== 4) {
          console.warn(`Invalid coordinates for ID ${id}:`, coords);
          return { id, coords: { x: 0, y: 0, width: 0, height: 0 }, text: "" };
        }

        // Ensure all values are numbers
        const coordArray = coords.map(Number);
        if (coordArray.some(Number.isNaN)) {
          console.warn(`Invalid coordinate values for ID ${id}:`, coords);
          return { id, coords: { x: 0, y: 0, width: 0, height: 0 }, text: "" };
        }

        // Convert proportional coordinates to actual pixels
        const [x, y, width, height] = coordArray;
        const pixelCoords = {
          x: Math.round(x * canvasWidth),
          y: Math.round(y * canvasHeight),
          width: Math.round(width * canvasWidth),
          height: Math.round(height * canvasHeight),
        };
        console.log(`Box ${id} converted coordinates:`, pixelCoords);

        // Extract text from the parsed response, accounting for the ID offset
        const text =
          parsedText
            .split('\n')
            .find((line) => line.startsWith(`Text Box ID ${id}:`))
            ?.replace(/^Text Box ID \d+: /, '')
            ?.trim() || '';

        return { id, coords: pixelCoords, text };
      })
      .filter((box) => box.text !== ''); // Filter out boxes with no text

    // Get all elements in the iframe
    const elements = Array.from(document.querySelectorAll('*'));
    console.log('Total DOM elements found:', elements.length);

    // For each box from the AI response, find matching elements
    // biome-ignore lint/complexity/noForEach: <explanation>
    boxes.forEach((box) => {
      if (!box.text) return;
      console.log('\nProcessing box:', {
        id: box.id,
        text: box.text,
        coords: box.coords,
      });

      let bestMatch: Element | null = null;
      let bestScore = 0;
      const debugMatches: Array<{
        element: Element;
        score: number;
        rect: DOMRect;
      }> = [];

      // biome-ignore lint/complexity/noForEach: <explanation>
      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();

        // Skip elements with no dimensions or if they're too small
        if (
          rect.width === 0 ||
          rect.height === 0 ||
          rect.width < 5 ||
          rect.height < 5
        )
          return;

        // Calculate overlap
        const overlap = intersects(rect, box.coords);

        // Calculate size ratio (prefer elements closer in size)
        const targetArea = box.coords.width * box.coords.height;
        const elementArea = rect.width * rect.height;
        const sizeSimilarity =
          Math.min(targetArea, elementArea) / Math.max(targetArea, elementArea);

        // Calculate position similarity based on center points
        const targetCenterX = box.coords.x + box.coords.width / 2;
        const targetCenterY = box.coords.y + box.coords.height / 2;
        const elementCenterX = rect.x + rect.width / 2;
        const elementCenterY = rect.y + rect.height / 2;

        const distanceX = Math.abs(targetCenterX - elementCenterX);
        const distanceY = Math.abs(targetCenterY - elementCenterY);
        const maxDistance = Math.max(canvasWidth, canvasHeight);
        const positionSimilarity = 1 - (distanceX + distanceY) / maxDistance;

        // Calculate text similarity if element has text
        const elementText = el.textContent?.toLowerCase() || '';
        const boxText = box.text.toLowerCase();
        let textSimilarity = 0;

        if (elementText.includes(boxText)) {
          textSimilarity = 1;
        } else if (elementText.length > 0 && boxText.length > 0) {
          const halfBoxText = boxText.substring(
            0,
            Math.floor(boxText.length / 2),
          );
          const halfElementText = elementText.substring(
            0,
            Math.floor(elementText.length / 2),
          );
          if (
            elementText.includes(halfBoxText) ||
            boxText.includes(halfElementText)
          ) {
            textSimilarity = 0.5;
          }
        }

        // Combined score (weighted)
        const score =
          (overlap ? 0.35 : 0) +
          sizeSimilarity * 0.25 +
          positionSimilarity * 0.25 +
          textSimilarity * 0.15;

        if (score > 0.1) {
          // Log all potentially relevant matches
          debugMatches.push({
            element: el,
            score,
            rect,
          });
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = el;
        }
      });

      console.log(
        `Found ${debugMatches.length} potential matches for "${box.text}"`,
      );
      debugMatches.sort((a, b) => b.score - a.score);
      debugMatches.slice(0, 3).forEach((match, i) => {
        console.log(`Match ${i + 1}:`, {
          element: match.element.tagName,
          text: match.element.textContent?.slice(0, 50),
          score: match.score.toFixed(3),
          rect: match.rect,
        });
      });

      if (bestMatch && bestScore > 0.3) {
        console.log('Selected best match:', {
          element: bestMatch.tagName,
          text: bestMatch.textContent?.slice(0, 50),
          score: bestScore.toFixed(3),
          rect: bestMatch.getBoundingClientRect(),
        });
        (bestMatch as HTMLElement).classList.add('omni-highlight');
        bestMatch.setAttribute('data-omni-text', box.text);
      } else {
        console.log(
          'No good match found for',
          box.text,
          'best score was',
          bestScore,
        );
      }
    });
  };

  const intersects = (rect1: DOMRect, rect2: Coordinates) => {
    return !(
      rect1.right < rect2.x ||
      rect1.left > rect2.x + rect2.width ||
      rect1.bottom < rect2.y ||
      rect1.top > rect2.y + rect2.height
    );
  };

  const analyzeScreenshot = async (context: ReplayerContext) => {
    if (analysisComplete) return;

    const iframe = document.querySelector('iframe');
    if (!iframe || !iframe.contentDocument) {
      console.error('No iframe found');
      return;
    }

    // Add highlight styles
    const style = iframe.contentDocument.createElement('style');
    style.textContent = `
      .omni-highlight {
        position: relative !important;
        outline: 2px solid #4A90E2 !important;
        background-color: rgba(255, 255, 0, 0.3) !important;
        transition: all 0.3s ease !important;
        z-index: 1000 !important;
      }
      .omni-highlight::after {
        content: attr(data-omni-text);
        position: absolute;
        top: -20px;
        left: 0;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 12px;
        white-space: nowrap;
        z-index: 1001;
      }
    `;
    iframe.contentDocument.head.appendChild(style);

    try {
      context.replayer.pause();
      const iframe = context.replayer.iframe;
      if (!iframe?.contentDocument) return;

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

      const client = await Client.connect('microsoft/OmniParser');
      const result = (await client.predict('/process', {
        image_input: blob,
        box_threshold: 0.05,
        iou_threshold: 0.1,
      })) as GradioResponse;

      onParseResults(
        result.data[1].split('\n').filter((line) => line.trim().length > 0),
      );

      void highlightMatchingElements(
        result.data[1],
        result.data[2],
        canvasWidth,
        canvasHeight,
      );

      analysisComplete = true;
    } catch (error) {
      console.error('Screenshot analysis error:', error);
    }
  };

  return {
    handler(event: eventWithTime, isSync: boolean, context: ReplayerContext) {
      if (event.type === EventType.FullSnapshot) {
        void analyzeScreenshot(context);
      }
    },
  };
};

export default function InteractivePlayer() {
  const playerElRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const { sessionId } = useParams();
  const [sessionName, setSessionName] = useState('');
  const [parseResults, setParseResults] = useState<string[]>([]);
  const toast = useToast();

  useEffect(() => {
    if (!sessionId) return;

    getSession(sessionId)
      .then((session) => {
        setSessionName(session.name);
      })
      .catch((err) => {
        console.error(err);
      });

    getEvents(sessionId)
      .then((events) => {
        if (!playerElRef.current) return;

        playerRef.current?.$destroy();

        playerRef.current = new Replayer({
          target: playerElRef.current as HTMLElement,
          props: {
            events,
            autoPlay: true,
            UNSAFE_replayCanvas: true,
            useVirtualDom: true,
            plugins: [
              // createClickHighlightPlugin(),
              // createMutationHighlightPlugin(),
              createScreenshotAnalysisPlugin(setParseResults),
            ],
          },
        });

        // Access the underlying Replayer instance
        const replayerInstance = playerRef.current.getReplayer();

        // Ensure interaction is disabled during playback
        replayerInstance.disableInteract();

        // When the player is paused, enable interaction
        playerRef.current.addEventListener('pause', () => {
          replayerInstance.enableInteract();

          // Patch the iframe to ensure interaction
          const iframe = replayerInstance.iframe;
          if (iframe) {
            iframe.style.pointerEvents = 'auto';
            iframe.style.userSelect = 'auto';
            iframe.removeAttribute('sandbox'); // Remove sandbox to avoid the warning

            try {
              const doc =
                iframe.contentDocument || iframe.contentWindow?.document;
              if (doc) {
                const style = doc.createElement('style');
                style.textContent = `
                  * {
                    pointer-events: auto !important;
                    user-select: auto !important;
                  }
                `;
                doc.head.appendChild(style);
              }
            } catch (e) {
              console.error('Error accessing iframe content:', e);
            }
          }
        });

        // When the player is played, disable interaction
        playerRef.current.addEventListener('play', () => {
          replayerInstance.disableInteract();

          // Remove interaction styles
          const iframe = replayerInstance.iframe;
          if (iframe) {
            iframe.style.pointerEvents = '';
            iframe.style.userSelect = '';
            // Restore the sandbox attribute
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

            try {
              const doc =
                iframe.contentDocument || iframe.contentWindow?.document;
              if (doc) {
                const styles = doc.querySelectorAll('style');
                styles.forEach((style) => {
                  if (
                    style.textContent &&
                    style.textContent.includes('pointer-events: auto')
                  ) {
                    style.remove();
                  }
                });
              }
            } catch (e) {
              console.error('Error accessing iframe content:', e);
            }
          }
        });
      })
      .catch((err) => {
        console.error(err);
      });

    return () => {
      playerRef.current?.pause();
    };
  }, [sessionId]);

  return (
    <VStack spacing={5} align="stretch">
      <Breadcrumb mb={5} fontSize="md">
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Sessions</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbItem>
          <BreadcrumbLink>{sessionName}</BreadcrumbLink>
        </BreadcrumbItem>
      </Breadcrumb>

      <Center>
        <Box ref={playerElRef}></Box>
      </Center>

      {parseResults.length > 0 && (
        <Box p={4} borderRadius="md" bg="gray.50">
          <Text fontSize="lg" fontWeight="bold" mb={3}>
            Parsed Elements:
          </Text>
          <Code display="block" whiteSpace="pre" p={4}>
            {parseResults.join('\n')}
          </Code>
        </Box>
      )}
    </VStack>
  );
}
