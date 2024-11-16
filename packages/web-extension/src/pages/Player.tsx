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
        
        target.style.border = '6px solid red';
        target.style.boxShadow = '0 0 10px 0 rgba(255, 0, 0, 0.5)';
        target.style.transform = 'scale(1.05)';
        target.style.transition = 'all 0.3s ease';
        
        setTimeout(() => {
          (target ).style.border = '';
        }, 500);
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
            plugins: [createClickHighlightPlugin()],
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
