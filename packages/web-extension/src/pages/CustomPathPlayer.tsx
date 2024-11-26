import {
  Box,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Button,
  Center,
  HStack,
  Select,
  VStack,
  useToast,
} from '@chakra-ui/react';
import {
  EventType,
  IncrementalSource,
  MouseInteractions,
  ReplayerEvents,
  type incrementalSnapshotEvent,
} from '@rrweb/types';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Replayer from 'rrweb-player';
import { getEvents, getSession } from '~/utils/storage';
import 'rrweb-player/dist/style.css';
import type { ReplayPlugin, eventWithTime } from 'rrweb';
import type { Mirror } from 'rrweb-snapshot';

interface PathPattern {
  name: string;
  generator: (width: number, height: number) => Array<{ x: number; y: number }>;
}

const pathPatterns: PathPattern[] = [
  {
    name: 'Circle',
    generator: (width, height) => {
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) / 4;
      const points = [];
      for (let angle = 0; angle <= 2 * Math.PI; angle += 0.1) {
        points.push({
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      }
      return points;
    },
  },
  {
    name: 'Zigzag',
    generator: (width, height) => {
      const points = [];
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        points.push({
          x: (width * i) / steps,
          y: height * (i % 2 === 0 ? 0.2 : 0.8),
        });
      }
      return points;
    },
  },
  {
    name: 'Spiral',
    generator: (width, height) => {
      const points = [];
      const centerX = width / 2;
      const centerY = height / 2;
      const maxRadius = Math.min(width, height) / 3;
      for (let angle = 0; angle <= 6 * Math.PI; angle += 0.1) {
        const radius = (angle / (6 * Math.PI)) * maxRadius;
        points.push({
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      }
      return points;
    },
  },
];

// Keep track of last position for smooth movements
let lastX = 500;  // Start more centered in typical viewport
let lastY = 300;
let moveDirection = Math.random() * Math.PI * 2; // Random initial direction in radians

// Generate position based on selected pattern mode
const generatePatternPosition = (mode: string) => {
  switch (mode) {
    case 'random':
      // Occasionally change direction more dramatically
      if (Math.random() < 0.1) {  // 10% chance to change direction
        moveDirection += (Math.random() * Math.PI - Math.PI/2);
      } else {
        // Slight direction adjustments
        moveDirection += (Math.random() * 0.5 - 0.25);
      }

      // Create longer strokes in the current direction
      const moveLength = Math.random() * 100 + 50;  // Move 50-150 pixels each time
      const deltaX = Math.cos(moveDirection) * moveLength;
      const deltaY = Math.sin(moveDirection) * moveLength;
      
      // Update position with boundaries for typical viewport
      lastX = Math.max(100, Math.min(900, lastX + deltaX));
      lastY = Math.max(100, Math.min(600, lastY + deltaY));
      
      // If we hit a boundary, reflect the direction
      if (lastX <= 100 || lastX >= 900) {
        moveDirection = Math.PI - moveDirection;
      }
      if (lastY <= 100 || lastY >= 600) {
        moveDirection = -moveDirection;
      }
      
      return {
        x: lastX,
        y: lastY
      };
    default:
      return {
        x: lastX,
        y: lastY
      };
  }
};

export default function CustomPathPlayer() {
  const playerElRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const { sessionId } = useParams();
  const [sessionName, setSessionName] = useState('');
  const [selectedPattern, setSelectedPattern] = useState<string>(
    pathPatterns[0].name,
  );
  const [speed, setSpeed] = useState(1);
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

        const pattern = pathPatterns.find((p) => p.name === selectedPattern);
        if (!pattern) return;

        const { width, height } = playerElRef.current.getBoundingClientRect();
        const points = pattern.generator(width, height);
        let currentPointIndex = 0;

        // Modify mouse movement events before passing to Replayer
        const modifiedEvents = events
          .map((event) => {
            if (
              event.type === EventType.IncrementalSnapshot &&
              event.data.source === IncrementalSource.MouseMove
            ) {

              console.log(event);
              // Get current point from pattern
              const point = points[currentPointIndex];

              // Move to next point
              currentPointIndex = (currentPointIndex + 1) % points.length;

              // Return modified event with positions from helper function
              return {
                ...event,
                data: {
                  ...event.data,
                  positions: event.data.positions.map((p) => ({
                    ...p,
                    ...generatePatternPosition('random')  // Using the new function
                  })),
                },
              };
            }

            // Filter out scroll events
            if (
              event.type === EventType.IncrementalSnapshot &&
              event.data.source === IncrementalSource.Scroll
            ) {
              return null;
            }

            return event;
          })
          .filter(Boolean) as eventWithTime[];

        playerRef.current = new Replayer({
          target: playerElRef.current as HTMLElement,
          props: {
            events: modifiedEvents,
            autoPlay: true,
            UNSAFE_replayCanvas: true,
            useVirtualDom: true,
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
            iframe.removeAttribute('sandbox');

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
        toast({
          title: 'Error loading session',
          description: err.message,
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
      });

    return () => {
      playerRef.current?.pause();
    };
  }, [sessionId, selectedPattern, speed]);

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

      <HStack spacing={4} justify="center">
        <Select
          value={selectedPattern}
          onChange={(e) => setSelectedPattern(e.target.value)}
          width="200px"
        >
          {pathPatterns.map((pattern) => (
            <option key={pattern.name} value={pattern.name}>
              {pattern.name}
            </option>
          ))}
        </Select>

        <Select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          width="150px"
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
        </Select>
      </HStack>

      <Center>
        <Box ref={playerElRef}></Box>
      </Center>
    </VStack>
  );
}
