import { useRef, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Replayer from 'rrweb-player';
import { EventType, IncrementalSource, MouseInteractions } from '@rrweb/types';
import {
  Box,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Center,
} from '@chakra-ui/react';
import { getEvents, getSession } from '~/utils/storage';
import 'rrweb-player/dist/style.css';
import type { eventWithTime } from '@rrweb/types';
import type { ReplayPlugin } from 'rrweb';

const createClickHighlightPlugin = (): ReplayPlugin => {
  return {
    handler(
      event: eventWithTime,
      isSync: boolean,
      context
    ) {
      if (
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.MouseInteraction &&
        event.data.type === MouseInteractions.Click
      ) {
        const target = context.replayer.getMirror().getNode(event.data.id) as HTMLElement | null;
        console.log(target);
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
          (target ).style.border = '';
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
      null
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
          pointerEvents: 'none'
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
    handler(
      event: eventWithTime,
      isSync: boolean,
      context
    ) {
      const iframeDocument = context.replayer.iframe.contentDocument;
      if (!iframeDocument) return;

      if (event.type === EventType.FullSnapshot ||
          (event.type === EventType.IncrementalSnapshot &&
           event.data.source === IncrementalSource.Mutation)) {
        
        if (event.type === EventType.FullSnapshot) {
          setTimeout(() => applyMaskingEffect(iframeDocument), 100);
        } else {
          applyMaskingEffect(iframeDocument);
        }
      }
    },
  };
};

export default function Player() {
  const playerElRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Replayer | null>(null);
  const { sessionId } = useParams();
  const [sessionName, setSessionName] = useState('');

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
              createClickHighlightPlugin(),
              createMutationHighlightPlugin()
            ],
          },
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
    <>
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
    </>
  );
}
