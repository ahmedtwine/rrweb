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
            UNSAFE_replayCanvas: true,
            useVirtualDom: true,
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
