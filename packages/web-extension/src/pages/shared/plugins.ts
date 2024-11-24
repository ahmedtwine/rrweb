import { EventType, IncrementalSource, MouseInteractions, type eventWithTime } from '@rrweb/types';

export const createClickHighlightPlugin = () => ({
  name: 'click-highlight',
  handler(event: eventWithTime) {
    if (
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.MouseInteraction &&
      event.data.type === MouseInteractions.Click
    ) {
      const target = document.querySelector(`[data-rr-id="${event.data.id}"]`);
      if (target) {
        target.classList.add('highlight-click');
        setTimeout(() => {
          target.classList.remove('highlight-click');
        }, 1000);
      }
    }
  },
});

export const createMutationHighlightPlugin = () => ({
  name: 'mutation-highlight',
  handler(event: eventWithTime) {
    if (
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.Mutation
    ) {
      // biome-ignore lint/complexity/noForEach: <explanation>
      event.data.adds?.forEach((addition) => {
        const target = document.querySelector(
          `[data-rr-id="${addition.node.id}"]`
        );
        if (target) {
          target.classList.add('highlight-mutation');
          setTimeout(() => {
            target.classList.remove('highlight-mutation');
          }, 1000);
        }
      });
    }
  },
});
