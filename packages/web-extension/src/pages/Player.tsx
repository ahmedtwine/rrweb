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
import 'rrweb-player/dist/style.css';

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
                /* Apply masking styles */
                background-color: rgba(108, 99, 255, 0.95);
                color: transparent;
                border-radius: 6px;
                box-shadow: 0 2px 8px rgba(108, 99, 255, 0.2);
                text-shadow: none;
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                overflow: hidden;
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
