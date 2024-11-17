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
    handler(event, isSync, context) {
      if (
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.MouseInteraction &&
        event.data.type === MouseInteractions.Click
      ) {
        const target = context.replayer.getMirror().getNode(event.data.id) as HTMLElement | null;
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
          pointerEvents: 'auto',
          cursor: 'pointer',
          // **Added transition for animation**
          transition: 'opacity 0.3s ease, backdrop-filter 0.3s ease',
        });

        // **Updated event listener to add animation on click**
        overlay.addEventListener('click', () => {
          overlay.style.opacity = '0';
          overlay.style.backdropFilter = 'blur(0px)';
          // Remove the overlay after the transition ends
          overlay.addEventListener(
            'transitionend',
            () => {
              overlay.remove();
            },
            { once: true }
          );
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

export default function Player() {
  const playerElRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null); // Use 'any' to simplify type issues with rrweb-player
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
              // createClickHighlightPlugin(), 
              createMutationHighlightPlugin()],
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
              const doc = iframe.contentDocument || iframe.contentWindow?.document;
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
              const doc = iframe.contentDocument || iframe.contentWindow?.document;
              if (doc) {
                const styles = doc.querySelectorAll('style');
                styles.forEach((style) => {
                  if (style.textContent && style.textContent.includes('pointer-events: auto')) {
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