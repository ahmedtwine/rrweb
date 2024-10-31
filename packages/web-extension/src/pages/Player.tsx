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
              // Target specific text-containing elements without children
              `
              p:not(:empty):not(:has(*)),
              span:not(:empty):not(:has(*)),
              h1:not(:empty):not(:has(*)),
              h2:not(:empty):not(:has(*)),
              h3:not(:empty):not(:has(*)),
              h4:not(:empty):not(:has(*)),
              h5:not(:empty):not(:has(*)),
              h6:not(:empty):not(:has(*)),
              label:not(:empty):not(:has(*)),
              a:not(:empty):not(:has(*)),
              li:not(:empty):not(:has(*)),
              td:not(:empty):not(:has(*)),
              th:not(:empty):not(:has(*)) {
                position: relative;
              }
              `,
              // Apply overlay mask using ::before pseudo-element
              `
              p:not(:empty):not(:has(*))::before,
              span:not(:empty):not(:has(*))::before,
              h1:not(:empty):not(:has(*))::before,
              h2:not(:empty):not(:has(*))::before,
              h3:not(:empty):not(:has(*))::before,
              h4:not(:empty):not(:has(*))::before,
              h5:not(:empty):not(:has(*))::before,
              h6:not(:empty):not(:has(*))::before,
              label:not(:empty):not(:has(*))::before,
              a:not(:empty):not(:has(*))::before,
              li:not(:empty):not(:has(*))::before,
              td:not(:empty):not(:has(*))::before,
              th:not(:empty):not(:has(*))::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background-color: rgba(108, 99, 255, 0.95);
                border-radius: 6px;
                box-shadow: 0 2px 8px rgba(108, 99, 255, 0.2);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                z-index: 1;
                pointer-events: none;
              }
              `,
              // Keep replayer elements transparent
              '.replayer-mouse, .replayer-mouse-tail { background-color: transparent !important; }',
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
