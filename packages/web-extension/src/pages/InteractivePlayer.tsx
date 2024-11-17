import { useRef, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Replayer } from 'rrweb';
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

// Define the config type based on playerConfig from rrweb
interface playerConfig {
  speed?: number;
  maxSpeed?: number;
  root?: Element;
  loadTimeout?: number;
  skipInactive?: boolean;
  showWarning?: boolean;
  showDebug?: boolean;
  blockClass?: string;
  liveMode?: boolean;
  insertStyleRules?: string[];
  triggerFocus?: boolean;
  UNSAFE_replayCanvas?: boolean;
  pauseAnimation?: boolean;
  mouseTail?: boolean | {
    duration?: number;
    lineCap?: string;
    lineWidth?: number;
    strokeStyle?: string;
  };
  useVirtualDom?: boolean;
  plugins?: ReplayPlugin[];
  target?: HTMLDivElement;
  autoPlay?: boolean;
}

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

class EnhancedReplayer extends Replayer {
  private observer: MutationObserver | null = null;
  private isInteractionEnabled = false;
  private originalSetConfig: any;

  constructor(events: eventWithTime[], config?: playerConfig) {
    super(events, {
      ...config,
      // Override default mouseTail to prevent it from interfering with interactions
      mouseTail: false,
    });

    // Store the original setConfig method
    this.originalSetConfig = this.setConfig;

    // Override setConfig to prevent disabling interactions
    (this as any).setConfig = (config: any) => {
      // Filter out any attempts to disable pointer events
      const filteredConfig = { ...config };
      if (this.isInteractionEnabled) {
        delete filteredConfig.mouseTail;
        delete filteredConfig.blockClass;
      }
      return this.originalSetConfig.call(this, filteredConfig);
    };

    this.setupIframeObserver();
  }

  private setupIframeObserver() {
    // Create a style element for the wrapper
    const wrapperStyle = document.createElement('style');
    wrapperStyle.textContent = `
      .replayer-wrapper {
        pointer-events: auto !important;
        width: 1200px !important;
        height: 800px !important;
        overflow: hidden !important;
        position: fixed !important;
        left: 50% !important;
        top: 50% !important;
        transform: translate(-50%, -50%) !important;
      }
      .replayer-wrapper iframe {
        pointer-events: auto !important;
        width: 100% !important;
        height: 100% !important;
      }
    `;
    document.head.appendChild(wrapperStyle);

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLIFrameElement) {
              this.patchIframe(node);
            } else if (node instanceof HTMLElement) {
              const iframe = node.querySelector('iframe');
              if (iframe) {
                this.patchIframe(iframe);
              }
            }
          });
        } else if (mutation.type === 'attributes' && 
                   mutation.target instanceof HTMLIFrameElement &&
                   (mutation.attributeName === 'style' || mutation.attributeName === 'sandbox')) {
          // Re-patch if style or sandbox attributes change
          this.patchIframe(mutation.target as HTMLIFrameElement);
        }
      }
    });

    // Observe the entire document for iframe changes
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'sandbox']
    });
  }

  private patchIframe(iframe: HTMLIFrameElement) {
    if (!this.isInteractionEnabled) return;

    // Override any inline styles that might disable interaction
    const originalStyle = iframe.style.cssText;
    iframe.style.cssText = originalStyle
      .replace(/pointer-events\s*:\s*none/gi, 'pointer-events: auto')
      .replace(/user-select\s*:\s*none/gi, 'user-select: auto');

    // Ensure pointer events are enabled
    iframe.style.setProperty('pointer-events', 'auto', 'important');
    iframe.style.setProperty('user-select', 'auto', 'important');

    // Set sandbox attributes while maintaining security
    const sandboxAttrs = [
      'allow-scripts',
      'allow-forms',
      'allow-modals',
      'allow-pointer-lock',
      'allow-popups',
      'allow-same-origin',
      'allow-downloads'
    ];
    iframe.setAttribute('sandbox', sandboxAttrs.join(' '));

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        // Remove any existing interaction styles
        const existingStyles = doc.querySelectorAll('style[data-enhanced-replayer]');
        existingStyles.forEach(style => style.remove());

        // Add new interaction styles
        const style = doc.createElement('style');
        style.setAttribute('data-enhanced-replayer', 'true');
        style.textContent = `
          * {
            pointer-events: auto !important;
            user-select: auto !important;
            -webkit-user-select: auto !important;
            cursor: auto;
          }
          
          a, button, input, select, textarea, [role="button"] {
            pointer-events: auto !important;
            cursor: pointer !important;
          }

          iframe {
            pointer-events: auto !important;
          }
        `;
        doc.head.appendChild(style);

        // Add event listeners to prevent default blocking
        const preventBlocking = (e: Event) => {
          e.stopPropagation();
          return true;
        };

        doc.addEventListener('mousedown', preventBlocking, true);
        doc.addEventListener('mouseup', preventBlocking, true);
        doc.addEventListener('click', preventBlocking, true);
        doc.addEventListener('input', preventBlocking, true);
        doc.addEventListener('change', preventBlocking, true);
      }
    } catch (e) {
      console.error('Error patching iframe document:', e);
    }
  }

  public enableInteract() {
    super.enableInteract();
    this.isInteractionEnabled = true;

    // Find and patch all existing iframes
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => this.patchIframe(iframe));

    // Ensure the wrapper allows interaction
    const wrapper = document.querySelector('.replayer-wrapper');
    if (wrapper instanceof HTMLElement) {
      wrapper.style.setProperty('pointer-events', 'auto', 'important');
    }
  }

  public disableInteract() {
    this.isInteractionEnabled = false;
    super.disableInteract();
  }

  public destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    super.destroy();
  }
}

export default function InteractivePlayer() {
  const playerElRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<EnhancedReplayer | null>(null);
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

        playerRef.current?.destroy();

        playerRef.current = new EnhancedReplayer(events, {
          target: playerElRef.current,
          autoPlay: true,
          UNSAFE_replayCanvas: true,
          useVirtualDom: true,
          plugins: [
            createClickHighlightPlugin(),
            createMutationHighlightPlugin()
          ],
        });

        // Handle player state changes to enable/disable interaction
        playerRef.current.on('pause', () => {
          playerRef.current?.enableInteract();
        });

        playerRef.current.on('play', () => {
          playerRef.current?.disableInteract();
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
      <Box h="800px">
        <Box ref={playerElRef}></Box>
      </Box>
    </>
  );
}
