import { useRef, useCallback, useEffect, useState } from 'react';
import {
  GoldenLayout,
  ComponentContainer,
  type LayoutConfig,
  type JsonValue,
} from 'golden-layout';
import { createRoot, type Root } from 'react-dom/client';
import { TableContentTab } from '@/components/TableContentTab';

function tabKey(filePath: string, tableName: string): string {
  return `${filePath}::${tableName}`;
}

interface TabState {
  filePath: string;
  tableName: string;
}

export function useGoldenLayout(containerRef: React.RefObject<HTMLDivElement | null>) {
  const layoutRef = useRef<GoldenLayout | null>(null);
  const reactRootsRef = useRef<Map<ComponentContainer, Root>>(new Map());
  const openTabsRef = useRef<Map<string, ComponentContainer>>(new Map());
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const layout = new GoldenLayout(container);

    layout.registerComponentFactoryFunction(
      'TableContentTab',
      (container: ComponentContainer, state: JsonValue | undefined) => {
        const tabState = state as unknown as TabState;
        const key = tabKey(tabState.filePath, tabState.tableName);

        const root = createRoot(container.element);
        reactRootsRef.current.set(container, root);
        openTabsRef.current.set(key, container);

        root.render(
          <TableContentTab
            filePath={tabState.filePath}
            tableName={tabState.tableName}
          />
        );

        setIsEmpty(false);

        return undefined;
      }
    );

    // Track when items are destroyed to detect empty state
    layout.on('itemDestroyed', () => {
      // Defer the check so the layout tree is updated
      requestAnimationFrame(() => {
        if (layoutRef.current) {
          const root = layoutRef.current.rootItem;
          const hasContent = root && root.contentItems.length > 0;
          setIsEmpty(!hasContent);
        }
      });
    });

    // Listen for beforeComponentRelease to clean up React roots
    layout.on('beforeComponentRelease', (component: unknown) => {
      // Find and clean up the container
      for (const [container, root] of reactRootsRef.current.entries()) {
        if (container.component === component) {
          root.unmount();
          reactRootsRef.current.delete(container);

          // Remove from open tabs
          for (const [key, c] of openTabsRef.current.entries()) {
            if (c === container) {
              openTabsRef.current.delete(key);
              break;
            }
          }
          break;
        }
      }
    });

    const initialConfig: LayoutConfig = {
      root: {
        type: 'row',
        content: [],
      },
    };
    layout.loadLayout(initialConfig);

    layoutRef.current = layout;

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (layoutRef.current) {
        const el = containerRef.current;
        if (el) {
          layoutRef.current.setSize(el.offsetWidth, el.offsetHeight);
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      for (const root of reactRootsRef.current.values()) {
        root.unmount();
      }
      reactRootsRef.current.clear();
      openTabsRef.current.clear();
      layout.destroy();
      layoutRef.current = null;
    };
  }, []);

  const addTab = useCallback((filePath: string, tableName: string, title: string) => {
    const layout = layoutRef.current;
    if (!layout) return;

    const key = tabKey(filePath, tableName);

    // Focus existing tab if already open
    const existingContainer = openTabsRef.current.get(key);
    if (existingContainer) {
      existingContainer.focus();
      return;
    }

    const componentState: TabState = { filePath, tableName };
    layout.addComponent('TableContentTab', componentState as unknown as JsonValue, title);
  }, []);

  return { addTab, isEmpty };
}
