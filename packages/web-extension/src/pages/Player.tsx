import { useRef, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Replayer from 'rrweb-player';
import {
  Box,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Center,
} from '@chakra-ui/react';
import { getEvents, getSession } from '~/utils/storage';

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

        const linkEl = document.createElement('link');
        linkEl.href =
          'https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/style.css';
        linkEl.rel = 'stylesheet';
        document.head.appendChild(linkEl);
        playerRef.current = new Replayer({
          target: playerElRef.current as HTMLElement,
          props: {
            events,
            autoPlay: true,
            insertStyleRules: [
              // Custom text masking style
              `
              p:not(:empty), span:not(:empty), div:not(.replayer-wrapper):not(.replayer-mouse):not(:empty):not(:has(*)) {
                background-color: rgba(108, 99, 255, 0.85);
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(108, 99, 255, 0.15),
                           inset 0 0 20px rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(12px) saturate(180%);
                -webkit-backdrop-filter: blur(12px) saturate(180%);
                padding: 6px 12px;
                margin: 3px 0;
                position: relative;
                z-index: 1;
                color: transparent;
                text-shadow: 0 0 10px rgba(0, 0, 0, 0.8);
                border: 1px solid rgba(255, 255, 255, 0.18);
                transform: translateZ(0);
                overflow: hidden;
              }
              `,
              // Enhanced heading and container masking
              `
              h1:not(:empty), h2:not(:empty), h3:not(:empty), h4:not(:empty), h5:not(:empty), h6:not(:empty),
              article:not(:empty), section:not(:empty) > *:not(:has(*)), label:not(:empty), li:not(:empty) {
                background-color: rgba(108, 99, 255, 0.9);
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(108, 99, 255, 0.2),
                           inset 0 0 32px rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(16px) saturate(180%);
                -webkit-backdrop-filter: blur(16px) saturate(180%);
                padding: 8px 16px;
                margin: 6px 0;
                position: relative;
                z-index: 1;
                color: transparent;
                text-shadow: 0 0 12px rgba(0, 0, 0, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.15);
                transform: translateZ(0);
                overflow: hidden;
              }
              `,
              // Keep replayer elements transparent
              '.replayer-mouse, .replayer-mouse-tail { background-color: transparent !important; }',
              // Sophisticated hover effect
              `
              p:not(:empty):hover, span:not(:empty):hover, div:not(.replayer-wrapper):not(.replayer-mouse):not(:empty):not(:has(*)):hover,
              h1:not(:empty):hover, h2:not(:empty):hover, h3:not(:empty):hover, h4:not(:empty):hover, h5:not(:empty):hover, h6:not(:empty):hover {
                background-color: rgba(108, 99, 255, 0.95);
                box-shadow: 0 12px 32px rgba(108, 99, 255, 0.25),
                           inset 0 0 40px rgba(255, 255, 255, 0.08);
                transform: translateY(-1px) translateZ(0);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
              }
              `
            ]
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
