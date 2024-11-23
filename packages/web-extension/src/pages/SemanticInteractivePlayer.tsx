import {
  Box,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Center,
  Text,
  VStack,
  useToast,
} from '@chakra-ui/react';
import type { eventWithTime } from '@rrweb/types';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getEvents, getSession } from '~/utils/storage';
import 'rrweb-player/dist/style.css';
import { EnhancedReplayer } from './semantic/enhanced-replayer';
import { SemanticProcessor } from './semantic/processor';
import type { SemanticLabel } from './semantic/types';
import { createClickHighlightPlugin, createMutationHighlightPlugin } from './shared/plugins';

export default function SemanticInteractivePlayer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [events, setEvents] = useState<eventWithTime[]>([]);
  const [semanticLabels, setSemanticLabels] = useState<SemanticLabel[]>([]);
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const replayerRef = useRef<EnhancedReplayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    async function loadAndProcessSession() {
      if (!sessionId || !containerRef.current) return;

      try {
        // Load session data
        const session = await getSession(sessionId);
        if (!session) {
          throw new Error('Session not found');
        }

        const events = await getEvents(sessionId);
        if (!events || events.length === 0) {
          throw new Error('No events found for session');
        }

        setEvents(events);

        // Process events for semantic labels
        const processor = new SemanticProcessor();
        const processedSession = await processor.processSession(events);
        setSemanticLabels(processedSession.semanticMapping);

        // Initialize replayer with processed data
        if (!replayerRef.current && containerRef.current) {
          const replayer = new EnhancedReplayer(
            events,
            {
              root: containerRef.current,
              skipInactive: true,
              showWarning: false,
              blockClass: 'no-record',
              plugins: [
                createClickHighlightPlugin(),
                createMutationHighlightPlugin(),
              ],
            },
            processedSession.semanticMapping
          );
          replayerRef.current = replayer;
        }

        setIsProcessing(false);
      } catch (err) {
        console.error('Failed to load session:', err);
        setError(err instanceof Error ? err.message : 'Failed to load session');
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Failed to load session',
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
      }
    }

    loadAndProcessSession();

    return () => {
      if (replayerRef.current) {
        replayerRef.current.destroy();
        replayerRef.current = null;
      }
    };
  }, [sessionId, toast]);

  if (error) {
    return (
      <Center h="100vh">
        <VStack spacing={4}>
          <Text color="red.500">{error}</Text>
          <Breadcrumb>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Back to Sessions</BreadcrumbLink>
            </BreadcrumbItem>
          </Breadcrumb>
        </VStack>
      </Center>
    );
  }

  return (
    <Box h="100vh" position="relative">
      <div ref={containerRef} className="replayer-wrapper" style={{ width: '100%', height: '100%' }} />
      {isProcessing && (
        <Center position="absolute" top="0" left="0" right="0" bottom="0" bg="rgba(0, 0, 0, 0.5)">
          <Text color="white">Processing session...</Text>
        </Center>
      )}
    </Box>
  );
}
